import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,link,unlink,type FileHandle} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join} from 'node:path';

const MAX_REPORT_BYTES=8*1024*1024;
const CHUNK_SIZE=64*1024;
/** Post-link verification failed. Target may exist and must not be trusted. */
export class UntrustedReportPublicationError extends Error {
 readonly code='REPORT_PUBLICATION_UNTRUSTED';
 readonly destinationPath:string;
 constructor(destinationPath:string,cause:unknown){
  super('REPORT_PUBLICATION_UNTRUSTED',{cause});
  this.name='UntrustedReportPublicationError';
  this.destinationPath=destinationPath;
 }
}
type ChunkWriter=(file:FileHandle,chunk:Uint8Array,offset:number)=>Promise<number>;
/**
 * Publish an explicitly saved diagnostic report as a NEW file, never truncate
 * an existing user file. A partial write only affects an unadvertised random
 * staging name in the destination directory. The final name is an exclusive
 * same-volume hard link after fsync and complete byte verification.
 *
 * No rename/copy fallback: filesystems lacking safe hard links are blocked.
 * Not a cross-process snapshot lock for the diagnostic evidence itself.
 */
export async function writeExclusiveReport({destinationPath,content,writeChunk,beforePublish,afterPublish}:{
 destinationPath:string;content:string;
 /** Test-only fault injection; never provided by renderer IPC. */
 writeChunk?:ChunkWriter;
 /** Test-only race injection; never provided by renderer IPC. */
 beforePublish?:()=>Promise<void>;
 /** Test-only fault injection immediately after exclusive linking. */
 afterPublish?:()=>Promise<void>;
}):Promise<void>{
 if(typeof destinationPath!=='string'||!isAbsolute(destinationPath)||
    !/\.(?:json|md)$/i.test(destinationPath)||
    typeof content!=='string')
  throw new Error('Invalid absolute JSON/Markdown report destination or format');
 const bytes=Buffer.from(content,'utf8');
 if(bytes.length===0||bytes.length>MAX_REPORT_BYTES)
  throw new Error('Report byte budget exceeded');
 const digest=createHash('sha256').update(bytes).digest('hex');
 const stage=join(dirname(destinationPath),'.'+basename(destinationPath)+'.staging-'+randomUUID()+'.tmp');
 const verify=async(path:string,expectedLinks:1|2=1)=>{
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==bytes.length)
   throw new Error('Report staging file identity, type or size mismatch');
  // During atomic publication, our private stage and final pathname share
  // exactly two links. At every other point the trusted report must be
  // isolated to one pathname, never a foreign hardlink alias.
  if(info.nlink!==expectedLinks)
   throw new Error('Unsafe diagnostic report hardlink alias');
  const flags=constants.O_RDONLY|(typeof constants.O_NOFOLLOW==='number'?constants.O_NOFOLLOW:0);
  const fd=await open(path,flags);
  try{
   const opened=await fd.stat();
   if(!opened.isFile()||opened.size!==info.size||
      opened.mtimeMs!==info.mtimeMs||opened.ctimeMs!==info.ctimeMs)
    throw new Error('Report file was changed while opening for verification');
   if(opened.nlink!==expectedLinks)
    throw new Error('Unsafe diagnostic report hardlink alias on descriptor');
   const hash=createHash('sha256');
   let total=0;
   while(total<bytes.length){
    const chunk=Buffer.allocUnsafe(Math.min(CHUNK_SIZE,bytes.length-total));
    const {bytesRead}=await fd.read(chunk,0,chunk.length,total);
    if(bytesRead<=0)throw new Error('Report staging file ended early');
    hash.update(chunk.subarray(0,bytesRead));
    total+=bytesRead;
   }
   const reread=await fd.stat();
   const after=await lstat(path);
   if(!after.isFile()||after.isSymbolicLink()||
      after.size!==info.size||after.mtimeMs!==info.mtimeMs||
      after.ctimeMs!==info.ctimeMs||reread.size!==opened.size||
      reread.mtimeMs!==opened.mtimeMs||reread.ctimeMs!==opened.ctimeMs||
      reread.nlink!==expectedLinks||after.nlink!==expectedLinks||
      hash.digest('hex')!==digest)
    throw new Error('Report changed or failed SHA-256 verification');
  }finally{await fd.close();}
 };
 let file:FileHandle|undefined;
 let failure:unknown;
 try{
  file=await open(stage,'wx',0o600);
  const writer:ChunkWriter=writeChunk??(async(handle,chunk,offset)=>
   (await handle.write(chunk,0,chunk.length,offset)).bytesWritten);
  let offset=0;
  while(offset<bytes.length){
   const chunk=bytes.subarray(offset,Math.min(bytes.length,offset+CHUNK_SIZE));
   const written=await writer(file,chunk,offset);
   if(!Number.isSafeInteger(written)||written<=0||written>chunk.length)
    throw new Error('Invalid or zero-progress report write');
   offset+=written;
  }
  await file.sync();
  await file.close();file=undefined;
  await verify(stage);
  if(beforePublish)await beforePublish();
  // Reject changes between the initial staging verification and publication.
  // This also guards test-injected races without touching an existing target.
  await verify(stage);
  try{await link(stage,destinationPath);}
  catch(error){
   const code=(error as NodeJS.ErrnoException).code;
   if(code==='EEXIST')
    throw new Error('Report destination already exists; refusing overwrite');
   if(['ENOTSUP','EOPNOTSUPP','EPERM','EXDEV'].includes(code??''))
    throw new Error('Destination filesystem cannot safely publish report without overwrite (hard links required)',{cause:error});
   throw error;
  }
  try{
   if(afterPublish)await afterPublish();
   await verify(destinationPath,2);
  }
  catch(error){
   // No portable Node API can atomically unlink only if this name still
   // references our published inode. Preserve any visible entry rather than
   // risk deleting a concurrent writer's replacement.
   throw new UntrustedReportPublicationError(destinationPath,error);
  }
 }catch(error){failure=error;}
 if(file){try{await file.close();}catch(error){failure??=error;}}
 try{await unlink(stage);}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT'){
   if(failure!==undefined)throw new AggregateError([failure,error],'Report staging cleanup failed');
   throw error;
  }
 }
 if(failure!==undefined)throw failure;
 // The private stage link has now been removed. A remaining foreign alias
 // would allow later edits or reads through an unreviewed filesystem path.
 // As above, preserve the visible destination on post-publish uncertainty.
 try{await verify(destinationPath,1);}
 catch(error){throw new UntrustedReportPublicationError(destinationPath,error);}
}
