import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {open,lstat,unlink,type FileHandle} from 'node:fs/promises';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';

const MAX_ARCHIVE_BYTES=512*1024;
const CHUNK_BYTES=64*1024;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type ChunkWriter=(handle:FileHandle,chunk:Uint8Array,position:number)=>Promise<number>;

/**
 * Write an immutable, content-addressed managed snapshot without overwriting
 * another writer's bytes. Successful writes are flushed before activation.
 * A recoverable write error removes only the file created by this attempt.
 *
 * Limits: This protects ordinary I/O failures, NOT power loss mid-write or a
 * malicious concurrent process replacing the archive pathname. A separate
 * verified recovery gate remains mandatory on every read.
 */
export async function persistImmutableSnapshot({archivePath,bytes,writeChunk}:{
 archivePath:string;
 bytes:Uint8Array;
 /** Dependency injection for deterministic disk-full and short-write tests. */
 writeChunk?:ChunkWriter;
}):Promise<void>{
 if(typeof archivePath!=='string'||!isAbsolute(archivePath)||
    !(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>MAX_ARCHIVE_BYTES)
  throw new Error('Invalid immutable archive path or byte budget');
 const expectedHash=digest(bytes);
 const verifyExisting=async()=>{
  const info=await lstat(archivePath);
  if(!info.isFile()||info.isSymbolicLink())
   throw new Error('Immutable archive path is a symlink or non-regular file');
  const current=await readPinnedRegularFile(archivePath,{maxBytes:MAX_ARCHIVE_BYTES,expected:info});
  if(digest(current)!==expectedHash)
   throw new Error('Immutable archive hash conflict');
 };
 let handle:FileHandle;
 try{handle=await open(archivePath,'wx',0o600);}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  await verifyExisting();
  return;
 }
 let failure:unknown;
 try{
  const writer:ChunkWriter=writeChunk??(async(file,chunk,position)=>{
   const {bytesWritten}=await file.write(chunk,0,chunk.length,position);
   return bytesWritten;
  });
  let position=0;
  while(position<bytes.length){
   const chunk=bytes.subarray(position,Math.min(bytes.length,position+CHUNK_BYTES));
   const written=await writer(handle,chunk,position);
   if(!Number.isSafeInteger(written)||written<=0||written>chunk.length)
    throw new Error('Invalid or zero-progress immutable archive write');
   position+=written;
  }
  await handle.sync();
 }catch(error){failure=error;}
 try{await handle.close();}
 catch(error){failure??=error;}
 if(failure!==undefined){
  // Only this operation created the archive. Do not remove an unrelated
  // preexisting destination when exclusive create returned EEXIST.
  try{await unlink(archivePath);}
  catch(cleanupError){
   if((cleanupError as NodeJS.ErrnoException).code!=='ENOENT')
    throw new AggregateError([failure,cleanupError],'Immutable archive write and cleanup both failed');
  }
  throw failure;
 }
 // Trust neither successful I/O nor a content-addressed filename alone.
 // Read back through the pinned reader before exposing this archive to restore.
 await verifyExisting();
}
