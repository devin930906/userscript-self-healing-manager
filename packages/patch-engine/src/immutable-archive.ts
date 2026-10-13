import {createHash,randomUUID} from 'node:crypto';
import {basename,dirname,isAbsolute,join} from 'node:path';
import {open,link,lstat,unlink,type FileHandle} from 'node:fs/promises';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {assertUnlinkedRecoveryDirectory} from '../../runtime-paths/src/recovery-directory.ts';

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
export async function persistImmutableSnapshot({archivePath,bytes,writeChunk,beforePublish,afterPublish}:{
 archivePath:string;
 bytes:Uint8Array;
 /** Deterministic disk-full/short-write injection for recovery tests. */
 writeChunk?:ChunkWriter;
 /** Internal synthetic race injection only; never routed from Electron renderer. */
 beforePublish?:()=>Promise<void>;
 /** Internal synthetic failure after new link; never sent from renderer. */
 afterPublish?:()=>Promise<void>;
}):Promise<void>{
 if(typeof archivePath!=='string'||!isAbsolute(archivePath)||
    !(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>MAX_ARCHIVE_BYTES)
  throw new Error('Invalid immutable archive path or byte budget');
 // An exported low-level writer cannot rely on callers to reject a symlink
 // or Windows Junction in an existing parent of the managed archive path.
 // This is a preflight, not an atomic cross-process pathname lock.
 await assertUnlinkedRecoveryDirectory(dirname(archivePath));
 const expectedHash=digest(bytes);
 const verify=async(path:string,requireSingleLink=false)=>{
  // A preexisting archive hardlinked to another pathname is mutable through
  // that alias, regardless of whether its bytes and SHA match right now.
  // New publication itself temporarily has TWO links (staging + final),
  // so demand isolation on private staging *before link*, on EEXIST,
  // and after private staging cleanup.
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())
   throw new Error('Immutable archive path is a symlink or non-regular file');
  if(requireSingleLink&&info.nlink!==1)
   throw new Error('Immutable archive hardlink alias detected');
  const current=await readPinnedRegularFile(path,{maxBytes:MAX_ARCHIVE_BYTES,expected:info});
  if(digest(current)!==expectedHash)
   throw new Error('Immutable archive hash conflict');
  if(requireSingleLink&&(await lstat(path)).nlink!==1)
   throw new Error('Immutable archive hardlink alias detected during verification');
 };
 // Neither the approved original nor the patched revision becomes addressable
 // by its SHA-256 filename until all the content is flushed and re-read.
 const staging=join(dirname(archivePath),'.'+basename(archivePath)+'.staging-'+randomUUID()+'.tmp');
 let handle:FileHandle|undefined;
 let failure:unknown;
 // Only remove a failed SHA-named archive if THIS call created its link and
 // the destination still denotes the originally verified staging inode.
 let linkedByThisCall=false;
 let approvedIdentity:{dev:bigint;ino:bigint;birthtimeNs:bigint;mode:bigint}|undefined;
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
  // Reject a preexisting foreign hardlink before the archive name is
  // published. Otherwise late failure would still leave an untrusted
  // hash-named backup visible in the managed store.
  // Approval applies to the verified staging object, not to the name that
  // another process could subsequently replace (even with identical bytes).
  const reviewedStage=await lstat(staging,{bigint:true});
  if(!reviewedStage.isFile()||reviewedStage.isSymbolicLink()||reviewedStage.nlink!==1n)
   throw new Error('Unsafe immutable staging file identity or hardlink alias');
  await verify(staging,true);
  const sameStage=(other:typeof reviewedStage):boolean=>
   other.isFile()&&!other.isSymbolicLink()&&other.nlink===1n&&
   other.dev===reviewedStage.dev&&other.ino===reviewedStage.ino&&
   other.birthtimeNs===reviewedStage.birthtimeNs&&other.mode===reviewedStage.mode;
  // Controlled injection at the post-verification publication gap.
  if(beforePublish)await beforePublish();
  // The same verified inode can be reached through a newly substituted
  // parent symlink/Junction. Recheck the directory ancestry at publication,
  // not only before staging. This remains a non-atomic path preflight.
  await assertUnlinkedRecoveryDirectory(dirname(archivePath));
  // A post-link hash failure is too late: it leaves an unapproved
  // hash-named backup visible. Reject substituted names BEFORE link().
  if(!sameStage(await lstat(staging,{bigint:true})))
   throw new Error('Immutable staging identity changed after verification');
  await verify(staging,true);
  if(!sameStage(await lstat(staging,{bigint:true})))
   throw new Error('Immutable staging changed before publication');
  try{
   // link(2) fails with EEXIST instead of overwriting another publisher;
   // the linked bytes were already synced and validated above.
   await link(staging,archivePath);
   linkedByThisCall=true;
   approvedIdentity={
    dev:reviewedStage.dev,ino:reviewedStage.ino,
    birthtimeNs:reviewedStage.birthtimeNs,mode:reviewedStage.mode,
   };
   if(afterPublish)await afterPublish();
  }catch(error){
   if((error as NodeJS.ErrnoException).code==='EEXIST'){
    await verify(archivePath,true);
   }else if(['ENOTSUP','EOPNOTSUPP','EPERM','EXDEV'].includes(
     (error as NodeJS.ErrnoException).code??'')){
    throw new Error('Managed data filesystem cannot atomically publish an immutable archive (hard links required)',{cause:error});
   }else throw error;
  }
  // Never trust a successful link or EEXIST alone.
  await verify(archivePath);
 }catch(error){failure=error;}
 if(failure!==undefined&&linkedByThisCall&&approvedIdentity){
  try{
   // This does NOT make publication atomic against uncooperative processes:
   // verify parents again before any cleanup, never follow a new Junction.
   await assertUnlinkedRecoveryDirectory(dirname(archivePath));
   const candidate=await lstat(archivePath,{bigint:true}).catch(error=>{
    if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;
    throw error;
   });
   if(candidate&&candidate.isFile()&&!candidate.isSymbolicLink()&&
      candidate.dev===approvedIdentity.dev&&candidate.ino===approvedIdentity.ino&&
      candidate.birthtimeNs===approvedIdentity.birthtimeNs&&
      candidate.mode===approvedIdentity.mode){
    await unlink(archivePath);
   }
  }catch(error){
   failure=new AggregateError([failure,error],'Failed to clean only owned immutable archive after publication error');
  }
 }
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
 // At this point the staging name no longer aliases a newly published
 // archive, so any remaining additional hardlink makes it non-immutable.
 await verify(archivePath,true);
}
