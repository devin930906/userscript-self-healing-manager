import {constants} from 'node:fs';
import type {Stats} from 'node:fs';
import {lstat,open} from 'node:fs/promises';

/**
 * Read a user-selected / managed file without trusting a path-only
 * lstat()->readFile() gap. Revalidate identity on the open descriptor and
 * the path before returning anything. Never follow symbolic links knowingly.
 *
 * This is intentionally NOT a cross-process write lock. Callers must still
 * enforce approval, hash validation, revision locks and safe output paths.
 */
export async function readPinnedRegularFile(path:string,{
 maxBytes,expected,
}:{maxBytes:number;expected?:Stats|undefined}):Promise<Buffer>{
 if(typeof path!=='string'||!path||!Number.isSafeInteger(maxBytes)||
    maxBytes<1||maxBytes>1024*1024)
  throw new Error('Invalid pinned read size limit or path');
 const before=await lstat(path);
 const validateFile=(info:Stats):void=>{
  if(info.isSymbolicLink()||!info.isFile())
   throw new Error('Unsafe pinned file: symlink or non-regular file');
  if(!Number.isSafeInteger(info.size)||info.size<0||info.size>maxBytes)
   throw new Error('Pinned file size exceeds allowed budget');
  if(!Number.isSafeInteger(info.ino)||info.ino<=0||
     !Number.isSafeInteger(info.dev))
   throw new Error('Pinned file identity unavailable');
 };
 const same=(left:Stats,right:Stats):boolean=>
  left.dev===right.dev&&left.ino===right.ino&&
  left.size===right.size&&left.mtimeMs===right.mtimeMs&&
  left.ctimeMs===right.ctimeMs;
 validateFile(before);
 if(expected&&(!expected.isFile()||!same(before,expected)))
  throw new Error('Pinned file was replaced since its approved snapshot');
 const noFollow=typeof constants.O_NOFOLLOW==='number'?constants.O_NOFOLLOW:0;
 const handle=await open(path,constants.O_RDONLY|noFollow);
 try{
  const opened=await handle.stat();
  validateFile(opened);
  if(!same(before,opened))throw new Error('Pinned file identity changed before open');
  const bytes=await handle.readFile();
  if(bytes.length>maxBytes)throw new Error('Pinned file exceeded byte limit during read');
  const reread=await handle.stat();
  validateFile(reread);
  if(!same(opened,reread))throw new Error('Pinned file changed during read');
  const after=await lstat(path);
  validateFile(after);
  if(!same(before,after))throw new Error('Pinned file identity changed during read');
  return bytes;
 }finally{
  await handle.close();
 }
}
