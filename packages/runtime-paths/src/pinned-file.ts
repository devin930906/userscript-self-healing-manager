import {constants} from 'node:fs';
import type {Stats,BigIntStats} from 'node:fs';
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
}:{maxBytes:number;expected?:Stats|BigIntStats|undefined}):Promise<Buffer>{
 if(typeof path!=='string'||!path||!Number.isSafeInteger(maxBytes)||
    maxBytes<1||maxBytes>1024*1024)
  throw new Error('Invalid pinned read size limit or path');
 const before=await lstat(path);
 const validateFile=(info:Stats):void=>{
  if(info.isSymbolicLink()||!info.isFile())
   throw new Error('Unsafe pinned file: symlink or non-regular file');
  if(!Number.isSafeInteger(info.size)||info.size<0||info.size>maxBytes)
   throw new Error('Pinned file size exceeds allowed budget');
  if(!Number.isFinite(info.ino)||!Number.isFinite(info.dev)||
     (process.platform!=='win32'&&
      (!Number.isSafeInteger(info.ino)||info.ino<=0||!Number.isSafeInteger(info.dev))))
   throw new Error('Pinned file identity unavailable');
 };
 // Node on Windows may report a zero, signed or rounded MFT index. It is
 // opaque metadata, not a trustworthy unique inode. Preserve the open
 // descriptor as the read authority and use an explicit metadata fallback
 // (including creation time), not an illusory comparison of zero file IDs.
 // This reduces path-swap exposure but is not a Win32 native file-ID API.
 const same=(left:Stats,right:Stats):boolean=>{
  const stableId=Number.isSafeInteger(left.ino)&&Number.isSafeInteger(right.ino)&&
   left.ino>0&&right.ino>0;
  if(!stableId&&process.platform!=='win32')return false;
  return left.dev===right.dev&&
   (stableId?left.ino===right.ino:
    left.ino===right.ino&&left.birthtimeMs===right.birthtimeMs)&&
   left.size===right.size&&left.mode===right.mode&&
   left.mtimeMs===right.mtimeMs&&left.ctimeMs===right.ctimeMs;
 };
 validateFile(before);
 if(expected){
  // Node overloads may type a caller lstat result as Stats|BigIntStats.
  // Reject BigInt snapshots rather than silently comparing incompatible units.
  if(typeof expected.ino!=='number'||typeof expected.size!=='number')
   throw new Error('Unsupported BigInt pinned-file snapshot');
  if(!expected.isFile()||!same(before,expected as Stats))
   throw new Error('Pinned file was replaced since its approved snapshot');
 }
 const noFollow=typeof constants.O_NOFOLLOW==='number'?constants.O_NOFOLLOW:0;
 const handle=await open(path,constants.O_RDONLY|noFollow);
 try{
  const opened=await handle.stat();
  validateFile(opened);
  if(!same(before,opened))throw new Error('Pinned file identity changed before open');
  // The file may grow AFTER lstat/open. Never use an unbounded whole-file read here:
  // that method could allocate the entire enlarged file before we reject it.
  // Read at most maxBytes + 1 directly from the pinned descriptor, in bounded
  // chunks. The extra byte distinguishes an over-budget file from exact fit.
  const chunks:Buffer[]=[];
  let total=0;
  while(total<=maxBytes){
   const budget=Math.min(64*1024,maxBytes+1-total);
   const chunk=Buffer.allocUnsafe(budget);
   const {bytesRead}=await handle.read(chunk,0,budget,total);
   if(bytesRead===0)break;
   total+=bytesRead;
   if(total>maxBytes)throw new Error('Pinned file exceeded byte limit during read');
   chunks.push(chunk.subarray(0,bytesRead));
  }
  const bytes=Buffer.concat(chunks,total);
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
