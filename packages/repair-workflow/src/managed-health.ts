import {createHash} from 'node:crypto';
import {lstat,readdir} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {listManagedRevisions} from './history.ts';

export type ManagedHealthStatus=
 'healthy'|'empty'|'missing-current'|'unarchived-current'|
 'damaged-archive'|'write-locked'|'staging-leftover'|'unsafe';
export interface ManagedIntegrityReport {
 readonly status:ManagedHealthStatus;
 readonly archiveCount:number;
 /** Returned ONLY if current bytes matched a verified immutable archive. */
 readonly activeHash:string|null;
}
const SHA=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const outcome=(status:ManagedHealthStatus,archiveCount=0,activeHash:string|null=null):ManagedIntegrityReport=>({
 status,archiveCount,activeHash,
});
/** Enumerate the exact managed hierarchy, never following symlinks or
 * opening the current while a cooperating writer holds the transaction lock.
 * Read-only diagnostics are intentionally not a stale-lock recovery API. */
export async function inspectManagedIntegrity({managedRoot,scriptId}:{
 managedRoot:string;scriptId:string;
}):Promise<ManagedIntegrityReport>{
 if(typeof managedRoot!=='string'||!isAbsolute(managedRoot)||
    typeof scriptId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(scriptId))
  throw new Error('Invalid managed root or unsafe scriptId');
 const managed=join(managedRoot,'managed');
 const folder=join(managed,scriptId);
 for(const directory of [managedRoot,managed,folder]){
  let stat:Awaited<ReturnType<typeof lstat>>;
  try{stat=await lstat(directory);}
  catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT')return outcome('empty');
   throw error;
  }
  if(stat.isSymbolicLink()||!stat.isDirectory())return outcome('unsafe');
 }
 const current=join(folder,'current.user.js');
 try{
  const lock=await lstat(current+'.write-lock');
  // A lock may belong to another running process or a crashed process.
  // Never silently steal, remove, or claim a consistent current snapshot.
  return outcome(lock.isDirectory()&&!lock.isSymbolicLink()?'write-locked':'unsafe');
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
 }
 let archives:Awaited<ReturnType<typeof listManagedRevisions>>;
 try{archives=await listManagedRevisions({managedRoot,scriptId});}
 catch(error){
  const message=String(error);
  if(/archiv(e|ed).*hash mismatch|corruption|archived revision is too large/i.test(message))
   return outcome('damaged-archive');
  return outcome('unsafe');
 }
 // An unexpected termination can leave an unpublished private stage behind.
 // No file contents, names or directories are returned; the UI only needs
 // to know that offline recovery/review is required. Never delete the stage.
 const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
 const orphanStage=new RegExp(
  '^\\.(?:current\\.user\\.js|(?:original|revision)-[a-f0-9]{64}\\.user\\.js)\\.staging-'+uuid+'\\.tmp$',
 );
 let names:string[];
 try{names=await readdir(folder);}catch{return outcome('unsafe',archives.length);}
 if(names.length>10000)return outcome('unsafe',archives.length);
 if(names.some(name=>orphanStage.test(name)))
  return outcome('staging-leftover',archives.length);
 let info:Awaited<ReturnType<typeof lstat>>;
 try{info=await lstat(current);}
 catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')
   return outcome(archives.length===0?'empty':'missing-current',archives.length);
  throw error;
 }
 if(info.isSymbolicLink()||!info.isFile()||info.size>512*1024)return outcome('unsafe',archives.length);
 let bytes:Buffer;
 try{bytes=await readPinnedRegularFile(current,{maxBytes:512*1024,expected:info});}
 catch{return outcome('unsafe',archives.length);}
 const hash=SHA(bytes);
 if(!archives.some(x=>x.hash===hash))return outcome('unarchived-current',archives.length);
 return outcome('healthy',archives.length,hash);
}
