import {createHash} from 'node:crypto';
import {constants,type BigIntStats} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {assertUnlinkedRecoveryDirectory} from '../../runtime-paths/src/recovery-directory.ts';

export interface RecoveryCopyExpected {
 readonly path:string;
 readonly sha256:string;
 readonly bytes:number;
}

/**
 * Stage a pre-audited recovery file by reading only its pinned source file
 * descriptor. Unlike path-based copyFile(), a late source symlink/rename
 * cannot cause a different private file to be copied into a recovery output.
 *
 * Failure leaves an incomplete, non-active stage for review, never a success
 * marker. This is not a native Windows FileIdInfo guarantee or protection
 * against an adversary modifying the same already-open file in place.
 */
export async function copyPinnedRecoveryFile({
 source,destination,expected,beforeSourceOpen,
}:{
 readonly source:string;readonly destination:string;
 readonly expected:RecoveryCopyExpected;
 /** Synthetic TDD fault injection; not supplied via the renderer/IPC. */
 readonly beforeSourceOpen?:()=>Promise<void>;
}):Promise<void>{
 const max=512*1024*1024;
 if(typeof source!=='string'||!isAbsolute(source)||
    typeof destination!=='string'||!isAbsolute(destination)||
    !expected||typeof expected.path!=='string'||
    !Number.isSafeInteger(expected.bytes)||expected.bytes<0||expected.bytes>max||
    typeof expected.sha256!=='string'||!/^[a-f0-9]{64}$/.test(expected.sha256)||
    (beforeSourceOpen!==undefined&&typeof beforeSourceOpen!=='function'))
  throw new Error('Invalid pinned recovery copy input');
 await assertUnlinkedRecoveryDirectory(dirname(source));
 await assertUnlinkedRecoveryDirectory(dirname(destination));
 const identical=(a:BigIntStats,b:BigIntStats):boolean=>
  a.isFile()&&!a.isSymbolicLink()&&b.isFile()&&!b.isSymbolicLink()&&
  a.nlink===1n&&b.nlink===1n&&
  a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs&&
  a.size===b.size&&a.mode===b.mode&&
  a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
 const before=await lstat(source,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||
    before.size!==BigInt(expected.bytes))
  throw new Error('Unsafe pinned recovery source identity or size');
 if(beforeSourceOpen)await beforeSourceOpen();
 const flags=constants.O_RDONLY|(typeof constants.O_NOFOLLOW==='number'?constants.O_NOFOLLOW:0);
 // POSIX O_NOFOLLOW rejects the late symlink with ELOOP. Do not pass
 // its absolute source path to a UI-facing recovery error.
 let input;
 try{input=await open(source,flags);}
 catch(error){
  if((error as NodeJS.ErrnoException).code==='ELOOP')
   throw new Error('Unsafe pinned recovery source symlink at descriptor open');
  throw error;
 }
 try{
  const opened=await input.stat({bigint:true});
  if(!identical(before,opened)||
     !identical(before,await lstat(source,{bigint:true})))
   throw new Error('Pinned recovery source replaced before descriptor open');
  // Only claim output after the source has been authenticated against the
  // pre-open snapshot. wx refuses existing files, directories and symlinks.
  const output=await open(destination,'wx',0o600);
  try{
   const hash=createHash('sha256');
   let offset=0;
   const chunk=Buffer.allocUnsafe(64*1024);
   while(offset<expected.bytes){
    const count=Math.min(chunk.length,expected.bytes-offset);
    const {bytesRead}=await input.read(chunk,0,count,offset);
    if(bytesRead<=0)throw new Error('Pinned recovery source ended early');
    hash.update(chunk.subarray(0,bytesRead));
    let consumed=0;
    while(consumed<bytesRead){
     const {bytesWritten}=await output.write(chunk,consumed,bytesRead-consumed,offset+consumed);
     if(bytesWritten<=0)throw new Error('Pinned recovery output write made no progress');
     consumed+=bytesWritten;
    }
    offset+=bytesRead;
   }
   // The approved manifest is authoritative: no unexpected trailing bytes.
   const extra=await input.read(Buffer.alloc(1),0,1,expected.bytes);
   if(extra.bytesRead!==0)throw new Error('Pinned recovery source grew beyond approved size');
   await output.sync();
   if(!identical(opened,await input.stat({bigint:true}))||
      !identical(opened,await lstat(source,{bigint:true})))
    throw new Error('Pinned recovery source changed during copy');
   const outputInfo=await output.stat({bigint:true});
   if(!outputInfo.isFile()||outputInfo.nlink!==1n||
      outputInfo.size!==BigInt(expected.bytes)||
      hash.digest('hex')!==expected.sha256)
    throw new Error('Pinned recovery copied bytes failed manifest verification');
  }finally{await output.close();}
 }finally{await input.close();}
}
