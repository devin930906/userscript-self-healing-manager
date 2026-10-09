import {createHash,randomUUID} from 'node:crypto';
import {join,isAbsolute,relative,dirname,basename,sep} from 'node:path';
import {lstat,realpath,open,link,unlink,type FileHandle} from 'node:fs/promises';
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
export async function exportManagedCurrent({managedRoot,scriptId,destinationPath}:{
 managedRoot:string;scriptId:string;destinationPath:string;
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

 // listManagedRevisions validates the managed path hierarchy and the content hashes.
 const archived=await listManagedRevisions({managedRoot,scriptId});
 if(!archived.length)throw new Error('No verified managed revision available for export');
 const currentPath=join(managedRoot,'managed',scriptId,'current.user.js');
 const info=await lstat(currentPath);
 if(!info.isFile()||info.isSymbolicLink()||info.size>512*1024)
  throw new Error('Unsafe managed current file');
 const content=await readPinnedRegularFile(currentPath,{maxBytes:512*1024,expected:info});
 const hash=createHash('sha256').update(content).digest('hex');
 if(!archived.some(r=>r.hash===hash))
  throw new Error('Managed current contains unverified external edits; refusing export');
 // Windows can follow a dangling symlink with exclusive-create flags; reject
 // any existing directory entry with lstat before attempting an exclusive write.
 try{
  await lstat(destinationPath);
  throw new Error('Export destination already exists; refusing overwrite');
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
 }
 // The Save dialog is not a filesystem write transaction. Stage + fsync +
 // pinned hash verify before an atomic no-replace publication in its folder.
 await publishExclusiveExport({destinationPath,bytes:content});
 return {path:destinationPath,hash,bytes:content.length};
}
