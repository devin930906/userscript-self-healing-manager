import {createHash,randomUUID} from 'node:crypto';
import {join,isAbsolute,relative,dirname,basename,sep} from 'node:path';
import {lstat,realpath,open,link,unlink,mkdir,rmdir,type FileHandle} from 'node:fs/promises';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {listManagedRevisions} from './history.ts';

export interface ExportManagedReceipt {readonly path:string;readonly hash:string;readonly bytes:number}

type ExportChunkWriter=(file:FileHandle,chunk:Uint8Array,position:number)=>Promise<number>;
/**
 * Never publish a partially written .user.js to the user's chosen location.
 * Stage on the SAME destination filesystem, flush and verify pinned bytes,
 * then introduce the final filename via an atomic no-replace hard link.
 * A failed or crashed staging write cannot create an incomplete final output.
 * No automatic fallback to rename/copy (which may overwrite a competing file).
 */
export async function publishExclusiveExport({destinationPath,bytes,writeChunk,beforePublish}:{
 destinationPath:string;bytes:Uint8Array;
 /** File fault simulation for deterministic recovery tests; never exposed via IPC. */
 writeChunk?:ExportChunkWriter;
 /** Deterministic late destination collision injection, used only in tests. */
 beforePublish?:()=>Promise<void>;
}):Promise<void>{
 if(typeof destinationPath!=='string'||!isAbsolute(destinationPath)||
    !/\.user\.js$/i.test(destinationPath)||
    !(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>512*1024)
  throw new Error('Invalid exclusive export destination or byte budget');
 const expectedHash=createHash('sha256').update(bytes).digest('hex');
 const stage=join(dirname(destinationPath),'.'+basename(destinationPath)+'.staging-'+randomUUID()+'.tmp');
 const validate=async(path:string)=>{
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())throw new Error('Unsafe exported file');
  const actual=await readPinnedRegularFile(path,{maxBytes:512*1024,expected:info});
  if(createHash('sha256').update(actual).digest('hex')!==expectedHash)
   throw new Error('Exported userscript verification hash mismatch');
 };
 let file:FileHandle|undefined;
 let failure:unknown;
 try{
  file=await open(stage,'wx',0o600);
  let position=0;
  const write:ExportChunkWriter=writeChunk??(async(handle,chunk,offset)=>
   (await handle.write(chunk,0,chunk.length,offset)).bytesWritten);
  while(position<bytes.length){
   const chunk=bytes.subarray(position,Math.min(bytes.length,position+64*1024));
   const wrote=await write(file,chunk,position);
   if(!Number.isSafeInteger(wrote)||wrote<=0||wrote>chunk.length)
    throw new Error('Invalid or zero-progress export staging write');
   position+=wrote;
  }
  await file.sync();
  await file.close();file=undefined;
  await validate(stage);
  if(beforePublish)await beforePublish();
  try{await link(stage,destinationPath);}
  catch(error){
   const code=(error as NodeJS.ErrnoException).code;
   if(code==='EEXIST')
    throw new Error('Export destination already exists; refusing overwrite');
   if(['ENOTSUP','EOPNOTSUPP','EPERM','EXDEV'].includes(code??''))
    throw new Error('Destination filesystem cannot safely publish an exclusive userscript export (hard links required)',{cause:error});
   throw error;
  }
  await validate(destinationPath);
 }catch(error){failure=error;}
 if(file){try{await file.close();}catch(error){failure??=error;}}
 try{await unlink(stage);}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT'){
   if(failure!==undefined)throw new AggregateError([failure,error],'Export staging cleanup failed');
   throw error;
  }
 }
 if(failure!==undefined)throw failure;
}

/** A '..'-prefixed child name is still a child; only the WHOLE '..' path
 * segment crosses out of the root. Apply to both lexical and real paths. */
function withinRoot(base:string,candidate:string):boolean{
 const rel=relative(base,candidate);
 return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));
}
/**
 * Copies an already verified managed current revision to a NEW userscript file.
 * Caller must obtain destinationPath from an OS Save dialog. Never overwrite,
 * never export silently modified scripts, and never mutate managed archives.
 */
export async function exportManagedCurrent({managedRoot,scriptId,destinationPath,beforePublish}:{
 managedRoot:string;scriptId:string;destinationPath:string;
 /** Internal deterministic race hook, never received from renderer IPC. */
 beforePublish?:()=>Promise<void>;
}):Promise<ExportManagedReceipt>{
 if(!isAbsolute(managedRoot)||!isAbsolute(destinationPath)||!destinationPath.toLowerCase().endsWith('.user.js'))
  throw new Error('Absolute .user.js export destination required');
 if(withinRoot(managedRoot,destinationPath))
  throw new Error('Cannot export into the managed data root');
 // Lexical checks alone can be bypassed by a user-created junction or symlink
 // in the Save dialog's parent directory (especially on Windows). Reject the
 // resolved parent if it aliases any part of managedRoot.
 const [resolvedRoot,resolvedParent]=await Promise.all([realpath(managedRoot),realpath(dirname(destinationPath))]);
 if(withinRoot(resolvedRoot,resolvedParent))
  throw new Error('Resolved export directory is inside managed data root');

 // Resolve and verify the managed hierarchy before obtaining a lease. This
 // same filesystem lock also serializes archive activation in other app
 // processes: the exported bytes must be from ONE consistent current revision.
 const archived=await listManagedRevisions({managedRoot,scriptId});
 if(!archived.length)throw new Error('No verified managed revision available for export');
 const currentPath=join(managedRoot,'managed',scriptId,'current.user.js');
 const lockPath=currentPath+'.write-lock';
 try{await mkdir(lockPath,{mode:0o700});}
 catch(error){
  if((error as NodeJS.ErrnoException).code==='EEXIST')
   throw new Error('Another managed current writer holds the filesystem lock; refusing export');
  throw error;
 }
 try{
  const info=await lstat(currentPath);
  if(!info.isFile()||info.isSymbolicLink()||info.size>512*1024)
   throw new Error('Unsafe managed current file');
  const content=await readPinnedRegularFile(currentPath,{maxBytes:512*1024,expected:info});
  const hash=createHash('sha256').update(content).digest('hex');
  if(!archived.some(r=>r.hash===hash))
   throw new Error('Managed current contains unverified external edits; refusing export');
  // Native Save dialogs do not reserve the selected name. Fail on an already
  // present file; the final hard link also handles a late competing publisher.
  try{
   await lstat(destinationPath);
   throw new Error('Export destination already exists; refusing overwrite');
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  }
  await publishExclusiveExport({destinationPath,bytes:content,...(beforePublish?{beforePublish}:{})});
  return {path:destinationPath,hash,bytes:content.length};
 }finally{
  // Export acquired this lease itself. Never auto-remove a preexisting lock.
  await rmdir(lockPath);
 }
}
