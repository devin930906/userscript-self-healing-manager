import {createHash,randomUUID} from 'node:crypto';
import {basename,dirname,isAbsolute,join} from 'node:path';
import {open,link,lstat,unlink,type FileHandle} from 'node:fs/promises';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';

const MAX_ARCHIVE_BYTES=512*1024;
const CHUNK_BYTES=64*1024;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type ChunkWriter=(handle:FileHandle,chunk:Uint8Array,position:number)=>Promise<number>;

/**
 * Stage and fsync full content before publishing an immutable archive path.
 * A same-directory hard link atomically introduces the final name *without*
 * replacing another writer's archive. A crashed or failed staging write leaves
 * no incomplete final archive; orphan staging names are ignored by history.
 *
 * Requires hard-link support on the managed filesystem. In particular, never
 * fall back to unsafe rename/copy over an existing immutable revision. This
 * is not a guarantee against malicious cross-process directory modification
 * or sudden hardware/storage-controller failures.
 */
export async function persistImmutableSnapshot({archivePath,bytes,writeChunk}:{
 archivePath:string;
 bytes:Uint8Array;
 /** Deterministic disk-full/short-write injection for recovery tests. */
 writeChunk?:ChunkWriter;
}):Promise<void>{
 if(typeof archivePath!=='string'||!isAbsolute(archivePath)||
    !(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>MAX_ARCHIVE_BYTES)
  throw new Error('Invalid immutable archive path or byte budget');
 const expectedHash=digest(bytes);
 const verify=async(path:string)=>{
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())
   throw new Error('Immutable archive path is a symlink or non-regular file');
  const current=await readPinnedRegularFile(path,{maxBytes:MAX_ARCHIVE_BYTES,expected:info});
  if(digest(current)!==expectedHash)
   throw new Error('Immutable archive hash conflict');
 };
 // Neither the approved original nor the patched revision becomes addressable
 // by its SHA-256 filename until all the content is flushed and re-read.
 const staging=join(dirname(archivePath),'.'+basename(archivePath)+'.staging-'+randomUUID()+'.tmp');
 let handle:FileHandle|undefined;
 let failure:unknown;
 try{
  handle=await open(staging,'wx',0o600);
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
  await handle.close();
  handle=undefined;
  await verify(staging);
  try{
   // link(2) fails with EEXIST instead of overwriting another publisher;
   // the linked bytes were already synced and validated above.
   await link(staging,archivePath);
  }catch(error){
   if((error as NodeJS.ErrnoException).code==='EEXIST'){
    await verify(archivePath);
   }else if(['ENOTSUP','EOPNOTSUPP','EPERM','EXDEV'].includes(
     (error as NodeJS.ErrnoException).code??'')){
    throw new Error('Managed data filesystem cannot atomically publish an immutable archive (hard links required)',{cause:error});
   }else throw error;
  }
  // Never trust a successful link or EEXIST alone.
  await verify(archivePath);
 }catch(error){failure=error;}
 if(handle){
  try{await handle.close();}catch(error){failure??=error;}
 }
 try{await unlink(staging);}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT'){
   if(failure!==undefined)throw new AggregateError([failure,error],'Immutable staging cleanup failed after write error');
   throw error;
  }
 }
 if(failure!==undefined)throw failure;
}
