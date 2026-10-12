import {lstatSync,readdirSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {readRepairCheckpointSummary} from '../../../../packages/scan-service/src/repair-checkpoint-store.ts';

const CHECKPOINT=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.sqlite$/i;
const SIDECAR=/\.sqlite-(?:wal|shm|journal)$/i;
const MAX_ENTRIES=256;

export interface RepairQueueRecoverySummary{
 readonly checkpointFiles:number;
 readonly completed:number;
 /** Every unfinished or failed row requires a NEW user review and approval. */
 readonly needsReview:number;
 /** A running task at restart could have committed an uncertain file write. */
 readonly uncertain:number;
 /** Incomplete, malformed, unsafe or uninspectable journal entries. */
 readonly unreadable:number;
}
const empty=():RepairQueueRecoverySummary=>({
 checkpointFiles:0,completed:0,needsReview:0,uncertain:0,unreadable:0,
});
function assertTrustedDirectory(directory:string){
 for(let current=resolve(directory);;current=dirname(current)){
  const info=lstatSync(current);
  if(!info.isDirectory()||info.isSymbolicLink())
   throw new Error('Unsafe checkpoint recovery directory');
  const parent=dirname(current);
  if(parent===current)return;
 }
}
/** Synchronous read-only startup visibility. Never repair, delete, or replay a
 * checkpoint. Fail closed without exposing any filesystem or script identity
 * to the renderer. Bound processing to avoid an untrusted userData DoS.
 */
export function inspectRepairQueueRecovery(dataRoot:string):RepairQueueRecoverySummary{
 const result=empty();
 if(typeof dataRoot!=='string'||!isAbsolute(dataRoot)||dataRoot.length>4096)
  return {...result,unreadable:1};
 try{assertTrustedDirectory(dataRoot);}
 catch{return {...result,unreadable:1};}
 const folder=join(dataRoot,'repair-queue');
 try{assertTrustedDirectory(folder);}
 catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')return result;
  return {...result,unreadable:1};
 }
 let entries:string[];
 try{entries=readdirSync(folder);}
 catch{return {...result,unreadable:1};}
 if(entries.length>MAX_ENTRIES)return {...result,unreadable:1};
 for(const name of entries){
  if(SIDECAR.test(name))continue;
  if(!CHECKPOINT.test(name)){
   result.unreadable++;
   continue;
  }
  result.checkpointFiles++;
  try{
   const summary=readRepairCheckpointSummary(join(folder,name));
   result.completed+=summary.completed;
   result.needsReview+=summary.needsReview;
   result.uncertain+=summary.uncertain;
  }catch{
   // A crash between exclusive reservation and SQLite initialisation leaves
   // an empty file. Corrupt/unsafe files are equally never silently ignored.
   result.unreadable++;
  }
 }
 return Object.freeze(result);
}
