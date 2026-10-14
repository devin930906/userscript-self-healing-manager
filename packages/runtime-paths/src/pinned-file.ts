import {createHash,timingSafeEqual} from 'node:crypto';
import {constants} from 'node:fs';
import type {Stats,BigIntStats} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {assertUnlinkedRecoveryDirectory} from './recovery-directory.ts';

/**
 * Read a user-selected / managed file without trusting a path-only
 * lstat()->readFile() gap. Revalidate identity on the open descriptor and
 * the path before returning anything. Never follow symbolic links knowingly.
 *
 * This is intentionally NOT a cross-process write lock. Callers must still
 * enforce approval, hash validation, revision locks and safe output paths.
 */
export async function readPinnedRegularFile(path:string,{
 maxBytes,expected,expectedNative,expectedSha256,
}:{maxBytes:number;expected?:Stats|BigIntStats|undefined;expectedNative?:BigIntStats|undefined;expectedSha256?:string|undefined}):Promise<Buffer>{
 if(typeof path!=='string'||!path||!Number.isSafeInteger(maxBytes)||
    maxBytes<1||maxBytes>1024*1024)
  throw new Error('Invalid pinned read size limit or path');
 // An ordinary leaf beneath a symlink/Junction ancestor still redirects
 // a pinned descriptor outside the selected tree. Reject lexical traversal
 // before resolve() can erase a linked path segment. This is a preflight,
 // not a race-free Win32 file handle / directory identity guarantee.
 if(path.split(/[\\/]/).includes('..'))
  throw new Error('Unsafe pinned file parent traversal');
 if(expectedSha256!==undefined&&
    (typeof expectedSha256!=='string'||!/^[0-9a-f]{64}$/.test(expectedSha256)))
  throw new Error('Invalid approved pinned file digest');
 await assertUnlinkedRecoveryDirectory(dirname(resolve(path)));
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
  // Even when Node reports a positive inode, Windows file indexes may
  // be reused or rounded. A different creation timestamp must never inherit
  // an older approved snapshot on any platform.
  return left.dev===right.dev&&
   left.ino===right.ino&&left.nlink===right.nlink&&
   left.birthtimeMs===right.birthtimeMs&&
   left.size===right.size&&left.mode===right.mode&&
   left.mtimeMs===right.mtimeMs&&left.ctimeMs===right.ctimeMs;
 };
 // The optional exact snapshot supplements, never replaces, Stats checks.
 // BigIntStats keeps an inode/MFT index beyond JS Number safe precision.
 // This is NOT a native Win32 FileIdInfo handle API or a process-wide lock.
 const sameNative=(left:BigIntStats,right:BigIntStats):boolean=>
  left.isFile()&&!left.isSymbolicLink()&&right.isFile()&&!right.isSymbolicLink()&&
  left.dev===right.dev&&left.ino===right.ino&&left.nlink===right.nlink&&
  left.size===right.size&&
  left.mode===right.mode&&left.birthtimeNs===right.birthtimeNs&&
  left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs;
 // Node numeric Stats can alias distinct Windows MFT identities when the
 // file index is rounded and timestamps collide (real hosted Windows CI
 // evidence: issue #139, merge-head run #38407637227). In this case no
 // path-only numeric comparison can authenticate an earlier approved file.
 // Require independently captured BigIntStats on Windows instead of
 // declaring a replaced file to be its old approved snapshot.
 if(process.platform==='win32'&&expected&&!expectedNative)
  throw new Error('Precise native snapshot required for Windows pinned file identity');
 validateFile(before);
 const nativeBefore=expectedNative?await lstat(path,{bigint:true}):undefined;
 if(expectedNative){
  if(typeof expectedNative.isFile!=='function'||
     typeof expectedNative.isSymbolicLink!=='function'||
     typeof expectedNative.ino!=='bigint'||typeof expectedNative.dev!=='bigint'||
     typeof expectedNative.size!=='bigint'||typeof expectedNative.nlink!=='bigint'||
     typeof expectedNative.birthtimeNs!=='bigint'||
     typeof expectedNative.mtimeNs!=='bigint'||typeof expectedNative.ctimeNs!=='bigint'||
     typeof expectedNative.mode!=='bigint'||!nativeBefore||
     !sameNative(expectedNative,nativeBefore))
   throw new Error('Precise pinned-file native snapshot identity changed');
 }
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
  const nativeOpened=expectedNative?await handle.stat({bigint:true}):undefined;
  if(expectedNative&&(!nativeBefore||!nativeOpened||
      !sameNative(nativeBefore,nativeOpened)))
   throw new Error('Precise pinned-file native identity changed before open');
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
  if(expectedNative&&(!nativeOpened||
      !sameNative(nativeOpened,await handle.stat({bigint:true}))))
   throw new Error('Precise pinned-file native identity changed during read');
  const after=await lstat(path);
  validateFile(after);
  if(!same(before,after))throw new Error('Pinned file identity changed during read');
  if(expectedNative&&(!nativeBefore||
      !sameNative(nativeBefore,await lstat(path,{bigint:true}))))
   throw new Error('Precise pinned-file native path changed during read');
  // Hash the verified descriptor bytes, not a later path reopen. This
  // supplements metadata identity where Windows file IDs can alias.
  if(expectedSha256!==undefined){
   const actual=createHash('sha256').update(bytes).digest();
   if(!timingSafeEqual(actual,Buffer.from(expectedSha256,'hex')))
    throw new Error('Pinned file bytes differ from approved digest');
  }
  return bytes;
 }finally{
  await handle.close();
 }
}
