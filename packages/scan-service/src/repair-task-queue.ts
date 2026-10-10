import {BatchPauseGate} from './pause-gate.ts';

/** A trusted main-process callback only. No source code, scripts or remote JS
 * are accepted as queue data. The caller must independently hash-check every
 * managed-file write; this queue never authorizes or performs filesystem writes. */
export interface RepairTask {
 readonly id:string;
 readonly scriptId:string;
 readonly approved:boolean;
 readonly execute:()=>Promise<unknown>;
}
export type RepairTaskStatus='queued'|'running'|'completed'|'failed'|'blocked'|'cancelled';
export interface RepairTaskRow {
 readonly id:string;
 readonly scriptId:string;
 readonly status:RepairTaskStatus;
 readonly attempts:number;
 /** Generic error code; exception messages can contain DOM/paths/secrets. */
 readonly errorCode:'TASK_EXECUTION_FAILED'|null;
}
export interface RepairTaskSnapshot {
 readonly items:readonly RepairTaskRow[];
 readonly paused:boolean;
 readonly cancelled:boolean;
 readonly running:boolean;
}
export interface RepairTaskQueue {
 run():Promise<RepairTaskSnapshot>;
 retryFailed():Promise<RepairTaskSnapshot>;
 pause():boolean;
 resume():void;
 cancel():void;
 snapshot():RepairTaskSnapshot;
}

/** Serial, approval-gated executor for explicitly requested managed repairs.
 * Failing one job does not poison unrelated jobs; retries require a separate
 * explicit call. Cancellation never pretends an in-flight write was rolled
 * back: its eventual completion remains visible in the audit snapshot.
 *
 * This is an in-memory scheduling foundation, NOT a durable or autonomous
 * userscript repair engine. Persist results through a separately verified
 * journal before enabling unattended filesystem operations.
 */
export function createRepairTaskQueue(tasks:readonly RepairTask[],
 options:{
  onProgress?:(snapshot:RepairTaskSnapshot)=>void;
  /** Separate trusted pre-write hash/backup/approval check, never invoked on unapproved jobs. */
  beforeDispatch?:(row:RepairTaskRow)=>Promise<boolean>|boolean;
 }={},
):RepairTaskQueue{
 if(!Array.isArray(tasks)||!tasks.length||tasks.length>1000)
  throw new Error('Invalid repair task queue budget');
 if(!options||typeof options!=='object'||Array.isArray(options)||
    (options.onProgress!==undefined&&typeof options.onProgress!=='function')||
    (options.beforeDispatch!==undefined&&typeof options.beforeDispatch!=='function'))
  throw new Error('Invalid repair task queue options');
 // Pin the pre-write gate itself against post-approval caller mutation.
 const beforeDispatch=options.beforeDispatch;
 const ids=new Set<string>();
 for(const task of tasks){
  if(!task||typeof task.id!=='string'||!/^[-a-zA-Z0-9_.:]{1,128}$/.test(task.id)||
     typeof task.scriptId!=='string'||!task.scriptId||task.scriptId.length>128||
     typeof task.approved!=='boolean'||typeof task.execute!=='function')
   throw new Error('Invalid repair task identity or approval');
  if(ids.has(task.id))throw new Error('Duplicate repair task identity');
  ids.add(task.id);
 }
 // Snapshot the reviewed identity and executable callback at construction.
 // Keep the original object ONLY as an additional revocation source. Changing
 // its operation, id or script reference can never authorize a different write.
 const planned=tasks.map(task=>Object.freeze({
  id:task.id,scriptId:task.scriptId,approved:task.approved,
  execute:task.execute,permissionSource:task,
 }));
 const gate=new BatchPauseGate();
 let active=false,stopped=false;
 // Every pause invalidates any asynchronous hash/backup verification in flight.
 let pauseEpoch=0;
 const rows:RepairTaskRow[]=planned.map(t=>({
  id:t.id,scriptId:t.scriptId,status:t.approved?'queued':'blocked',
  attempts:0,errorCode:null,
 }));
 const snapshot=():RepairTaskSnapshot=>Object.freeze({
  items:Object.freeze(rows.map(row=>Object.freeze({...row}))),
  paused:gate.isPaused,cancelled:stopped,running:active,
 });
 const emit=()=>{
  // An optional UI observer cannot make a completed job become a failed
  // filesystem operation. Journal persistence is a separate release gate.
  try{options.onProgress?.(snapshot());}catch{}
 };
 const update=(index:number,status:RepairTaskStatus,attempts=rows[index]!.attempts,
  errorCode:RepairTaskRow['errorCode']=null)=>{
  rows[index]=Object.freeze({...rows[index]!,status,attempts,errorCode});
  emit();
 };
 const run=async():Promise<RepairTaskSnapshot>=>{
  if(stopped)throw new Error('Cancelled repair queue cannot be restarted');
  if(active)throw new Error('Repair queue is already running');
  active=true;emit();
  try{
   for(let i=0;i<planned.length;i++){
    if(stopped)break;
    if(rows[i]!.status!=='queued')continue;
    if(!(await gate.waitUntilReady())||stopped)break;
    const task=planned[i]!;
    // The caller cannot mutate the approval field after a queue starts:
    // however, approval is re-checked before every dispatch.
    if(task.approved!==true||task.permissionSource.approved!==true){update(i,'blocked');continue;}
    update(i,'running',rows[i]!.attempts+1);
    // Progress listeners run synchronously at the last dispatch boundary.
    // They may revoke consent or cancel the queue before the operation
    // callback has actually started: check both again after notification.
    if(stopped){update(i,'cancelled');break;}
    if(task.permissionSource.approved!==true){update(i,'blocked');continue;}
    // A progress observer may pause while this row is newly marked running.
    // No callback is dispatched until the user explicitly resumes it.
    if(!(await gate.waitUntilReady())||stopped){update(i,'cancelled');break;}
    if(task.permissionSource.approved!==true){update(i,'blocked');continue;}
    if(beforeDispatch){
     let validated=false;
     while(!validated){
      const verifiedAtEpoch=pauseEpoch;
      let authorized=false;
      try{
       // The caller independently verifies approval, source hash and backups.
       // Never reveal callback error text: it may contain private script data.
       authorized=(await beforeDispatch(Object.freeze({...rows[i]!})))===true;
      }catch{}
      if(stopped){update(i,'cancelled');break;}
      if(task.permissionSource.approved!==true){update(i,'blocked');break;}
      if(!authorized){update(i,'blocked');break;}
      // A pause during an awaited preflight invalidates that preflight even
      // when resume happened before it finished. Re-run the trusted check.
      if(gate.isPaused||pauseEpoch!==verifiedAtEpoch){
       if(!(await gate.waitUntilReady())||stopped){update(i,'cancelled');break;}
       if(task.permissionSource.approved!==true){update(i,'blocked');break;}
       continue;
      }
      validated=true;
     }
     if(!validated){if(stopped)break;continue;}
    }
    try{
     await task.execute();
     // Cancellation is not rollback. An in-flight operation that completed
     // must be reflected as completed rather than falsely called cancelled.
     update(i,'completed');
    }catch{
     update(i,'failed',rows[i]!.attempts,'TASK_EXECUTION_FAILED');
    }
   }
  }finally{
   active=false;emit();
  }
  return snapshot();
 };
 const retryFailed=async():Promise<RepairTaskSnapshot>=>{
  if(stopped)throw new Error('Cancelled repair queue cannot be retried');
  if(active)throw new Error('Cannot retry while queue is running');
  for(let i=0;i<planned.length;i++)if(rows[i]!.status==='failed'&&
   planned[i]!.approved===true&&planned[i]!.permissionSource.approved===true)
   update(i,'queued',rows[i]!.attempts);
  return run();
 };
 return Object.freeze({
  run,retryFailed,
  pause:()=>{const paused=gate.pause();if(paused)pauseEpoch++;return paused;},
  resume:()=>gate.resume(),
  cancel:()=>{
   if(stopped)return;
   stopped=true;gate.cancel();
   for(let i=0;i<rows.length;i++)if(rows[i]!.status==='queued')update(i,'cancelled');
   emit();
  },
  snapshot,
 });
}
