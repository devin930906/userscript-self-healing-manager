import {lstatSync,readdirSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {readRepairCheckpointSummary} from '../../../../packages/scan-service/src/repair-checkpoint-store.ts';

const CHECKPOINT=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.sqlite$/i;
const SIDECAR=/^(.*\.sqlite)-(?:wal|shm|journal)$/i;
const MAX_ENTRIES=256;

export interface RepairQueueRecoverySummary{
 readonly checkpointFiles:number;
 readonly completed:number;
 /** Every unfinished or failed row requires a NEW user review and approval. */
 readonly needsReview:number;
 /** An interrupted running OR failed dispatched write may have activated a revision. */
 readonly uncertain:number;
 /** Incomplete, malformed, unsafe or uninspectable journal entries. */
 readonly unreadable:number;
}
type MutableSummary={-readonly [K in keyof RepairQueueRecoverySummary]:number};
const empty=():MutableSummary=>({
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
 // A WAL, SHM or rollback-journal suffix is not itself evidence of a valid
 // checkpoint. Unpaired/invalid sidecars can be evidence of a crash or
 // tampering, and must not disappear from the startup recovery summary.
 // Match Windows case-insensitive filenames without resolving or opening any
 // sidecar path (the SQLite reader separately validates existing sidecars).
 const names=new Set(entries.map(name=>process.platform==='win32'?name.toLowerCase():name));
 // Old Alpha builds used the caller's UUID spelling in SQLite filenames.
 // On case-sensitive filesystems, two files may represent ONE approval.
 // Never report either alias as independently completed work.
 const seenApprovals=new Set<string>(),ambiguousApprovals=new Set<string>();
 for(const name of entries){
  if(!CHECKPOINT.test(name))continue;
  const identity=name.toLowerCase();
  if(seenApprovals.has(identity))ambiguousApprovals.add(identity);
  seenApprovals.add(identity);
 }
 for(const name of entries){
  const sidecar=SIDECAR.exec(name);
  if(sidecar){
   const database=sidecar[1]!;
   const expected=process.platform==='win32'?database.toLowerCase():database;
   if(CHECKPOINT.test(database)&&names.has(expected))continue;
   result.unreadable++;
   continue;
  }
  if(!CHECKPOINT.test(name)){
   result.unreadable++;
   continue;
  }
  result.checkpointFiles++;
  if(ambiguousApprovals.has(name.toLowerCase())){
   result.unreadable++;
   continue;
  }
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
