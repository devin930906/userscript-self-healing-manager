import {createHash,randomUUID} from 'node:crypto';
import {basename,dirname,isAbsolute,join} from 'node:path';
import {open,lstat,rename,link,unlink,type FileHandle} from 'node:fs/promises';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';

const MAX_BYTES=512*1024;
const CHUNK=64*1024;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type ChunkWriter=(handle:FileHandle,chunk:Uint8Array,position:number)=>Promise<number>;

/**
 * Restore a verified, approved revision to current.user.js.
 *
 * Stage, flush and hash-check BEFORE atomic rename. Immediately before rename,
 * repeat the external-edit check for the previous current to avoid replacing
 * edits made while staging. This reduces the race window, but Node's rename is
 * not a cross-process compare-and-swap or a full power-loss transaction.
 */
export async function commitManagedCurrent({activePath,bytes,expectedActiveHash,writeChunk,beforePublish}:{
 activePath:string;bytes:Uint8Array;expectedActiveHash:string|null;
 /** Test injection of short writes, disk faults and external file edits. */
 writeChunk?:ChunkWriter;
 /** Internal deterministic race injection only; never passed from renderer. */
 beforePublish?:()=>Promise<void>;
}):Promise<void>{
 if(typeof activePath!=='string'||!isAbsolute(activePath)||
    !(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>MAX_BYTES||
    (expectedActiveHash!==null&&
     (typeof expectedActiveHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedActiveHash))))
  throw new Error('Invalid managed current path, byte budget or expected hash');

 const validateCurrent=async()=>{
  let info:Awaited<ReturnType<typeof lstat>>;
  try{info=await lstat(activePath);}
  catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT'){
    if(expectedActiveHash===null)return;
    throw new Error('Managed current changed or disappeared before activation');
   }
   throw error;
  }
  if(expectedActiveHash===null)
   throw new Error('Managed current appeared during staging; external change rejected');
  if(!info.isFile()||info.isSymbolicLink())
   throw new Error('Unsafe externally changed managed current file');
  const current=await readPinnedRegularFile(activePath,{maxBytes:MAX_BYTES,expected:info});
  if(digest(current)!==expectedActiveHash)
   throw new Error('Managed current hash changed during staging; external edit rejected');
 };
 const stage=join(dirname(activePath),'.'+basename(activePath)+'.staging-'+randomUUID()+'.tmp');
 let handle:FileHandle|undefined;
 let failure:unknown;
 try{
  // Detect preexisting foreign edits before any new stage is started.
  await validateCurrent();
  handle=await open(stage,'wx',0o600);
  const writer:ChunkWriter=writeChunk??(async(file,chunk,position)=>{
   const {bytesWritten}=await file.write(chunk,0,chunk.length,position);
   return bytesWritten;
  });
  let position=0;
  while(position<bytes.length){
   const chunk=bytes.subarray(position,Math.min(bytes.length,position+CHUNK));
   const amount=await writer(handle,chunk,position);
   if(!Number.isSafeInteger(amount)||amount<=0||amount>chunk.length)
    throw new Error('Invalid staged current write progress');
   position+=amount;
  }
  await handle.sync();
  await handle.close();
  handle=undefined;
  const stagedInfo=await lstat(stage);
  const staged=await readPinnedRegularFile(stage,{maxBytes:MAX_BYTES,expected:stagedInfo});
  if(digest(staged)!==digest(bytes))throw new Error('Staged managed current hash mismatch');
  // For first activation, rename() could silently overwrite a file created
  // by another process just after our last lstat. hard-link publication is
  // atomic NO-REPLACE for absent current, exactly like immutable archives.
  await validateCurrent();
  if(beforePublish)await beforePublish();
  if(expectedActiveHash===null){
   try{await link(stage,activePath);}
   catch(error){
    if((error as NodeJS.ErrnoException).code==='EEXIST')
     throw new Error('Managed current appeared during staging; external change rejected');
    throw error;
   }
  }else{
   // Replacing an existing current still has a cross-process compare/rename
   // window. Native compare-and-swap or OS process lock is a remaining gate.
   await rename(stage,activePath);
  }
  const activatedInfo=await lstat(activePath);
  const activated=await readPinnedRegularFile(activePath,{maxBytes:MAX_BYTES,expected:activatedInfo});
  if(digest(activated)!==digest(bytes))
   throw new Error('Activated managed current verification failed; immutable archive remains available');
 }catch(error){failure=error;}
 if(handle){
  try{await handle.close();}catch(error){failure??=error;}
 }
 try{await unlink(stage);}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT'){
   if(failure!==undefined)throw new AggregateError([failure,error],'Managed current staging cleanup failed');
   throw error;
  }
 }
 if(failure!==undefined)throw failure;
}
