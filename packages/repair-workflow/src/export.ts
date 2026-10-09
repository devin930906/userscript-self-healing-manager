import {createHash} from 'node:crypto';
import {join,isAbsolute,relative,dirname} from 'node:path';
import {lstat,writeFile,realpath} from 'node:fs/promises';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {listManagedRevisions} from './history.ts';

export interface ExportManagedReceipt {readonly path:string;readonly hash:string;readonly bytes:number}
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
 const relativeToRoot=relative(managedRoot,destinationPath);
 if(relativeToRoot===''||(!relativeToRoot.startsWith('..')&&!isAbsolute(relativeToRoot)))
  throw new Error('Cannot export into the managed data root');
 // Lexical checks alone can be bypassed by a user-created junction or symlink
 // in the Save dialog's parent directory (especially on Windows). Reject the
 // resolved parent if it aliases any part of managedRoot.
 const [resolvedRoot,resolvedParent]=await Promise.all([realpath(managedRoot),realpath(dirname(destinationPath))]);
 const resolvedRel=relative(resolvedRoot,resolvedParent);
 if(resolvedRel===''||(!resolvedRel.startsWith('..')&&!isAbsolute(resolvedRel)))
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
 try{
  // Exclusive create is deliberately required even after the native Save dialog.
  // It also rejects a symlink occupying the destination.
  await writeFile(destinationPath,content,{flag:'wx',mode:0o600});
 }catch(error){
  if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('Export destination already exists; refusing overwrite');
  throw error;
 }
 return {path:destinationPath,hash,bytes:content.length};
}
