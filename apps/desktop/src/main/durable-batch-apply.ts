import {open} from 'node:fs/promises';
import {lstatSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {createRepairTaskQueue,type RepairTaskStatus} from '../../../../packages/scan-service/src/repair-task-queue.ts';
import {openRepairCheckpointStore} from '../../../../packages/scan-service/src/repair-checkpoint-store.ts';
import {reserveManagedScriptWrites} from './managed-script-lease.ts';

function assertTrustedAncestors(directory:string):void{
 for(let current=resolve(directory);;current=dirname(current)){
  const entry=lstatSync(current);
  if(!entry.isDirectory()||entry.isSymbolicLink())
   throw new Error('Unsafe repair queue data directory');
  const parent=dirname(current);
  if(parent===current)return;
 }
}

/**
 * Run one freshly native-approved managed batch write through a durable queue.
 *
 * A UUID-specific SQLite checkpoint is reserved exclusively BEFORE any
 * managed write; a reused (even empty or interrupted) checkpoint is refused
 * rather than inheriting obsolete approval after restart. This helper never
 * runs background work, replays interrupted writes, or changes source files.
 *
 * preflight is trusted Main-process verification of the current review and
 * scan. It runs again immediately before the managed write is dispatched.
 * The durable journal records only opaque hashed job identities and finite
 * statuses; no source paths, patch bytes or exception text are stored.
 */
export async function executeDurableApprovedBatch<T>(input:{
 dataRoot:string;
 approvalId:string;
 scriptId:string;
 preflight:()=>boolean|Promise<boolean>;
 write:()=>Promise<T>;
 /** Observes only the public enum status, never a script ID or file path. */
 onProgress?:(status:RepairTaskStatus)=>void;
 /** Main-owned cancellation lease; never a renderer-controlled callback. */
 onRegisterCancel?:(cancel:()=>void,pause:()=>boolean,resume:()=>void)=>(()=>void);
}):Promise<T>{
 if(!input||typeof input!=='object'||Array.isArray(input)||
    typeof input.dataRoot!=='string'||!isAbsolute(input.dataRoot)||
    typeof input.approvalId!=='string'||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.approvalId)||
    typeof input.scriptId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(input.scriptId)||
    typeof input.preflight!=='function'||typeof input.write!=='function'||
    (input.onProgress!==undefined&&typeof input.onProgress!=='function')||
    (input.onRegisterCancel!==undefined&&typeof input.onRegisterCancel!=='function'))
  throw new Error('Invalid durable repair approval identity');

 // Reserve the script before the first await, across BOTH managed write paths.
 const releaseManagedScript=reserveManagedScriptWrites(input.dataRoot,[input.scriptId]);
 try{
 assertTrustedAncestors(input.dataRoot);
 const folder=join(input.dataRoot,'repair-queue');
 await mkdir(folder,{recursive:true});
 assertTrustedAncestors(folder);
 const destination=join(folder,input.approvalId+'.sqlite');
 // 'wx' makes first use of this approval atomic, even across processes.
 // Never delete/reuse an interrupted checkpoint just to restart the write.
 let reservation:Awaited<ReturnType<typeof open>>;
 try{
  reservation=await open(destination,'wx',0o600);
 }catch{
  // Never leak private userData paths (including on EEXIST). Even a failed
  // reservation cannot grant permission to replay an earlier approval.
  throw new Error('Durable repair checkpoint unavailable; fresh review required');
 }
 await reservation.close();
 const store=openRepairCheckpointStore(destination);
 let releaseCancellation:()=>void=()=>{};
 try{
  let written=false;
  let output:T|undefined;
  const queue=createRepairTaskQueue([{
   id:input.approvalId,scriptId:input.scriptId,approved:true,
   execute:async()=>{
    output=await input.write();
    written=true;
   },
  }],{
   beforeDispatch:async()=>await input.preflight()===true,
   onProgress:status=>input.onProgress?.(status.items[0]!.status),
   onCheckpoint:checkpoint=>store.save(checkpoint),
  });
  if(input.onRegisterCancel){
   let release:()=>void;
   try{
    release=input.onRegisterCancel(()=>queue.cancel(),()=>queue.pause(),()=>queue.resume());
   }catch{
    // Main may throw an exception containing original source, paths or tokens.
    throw new Error('Native batch cancellation registration failed; fresh review required');
   }
   if(typeof release!=='function')throw new Error('Invalid batch cancellation registration');
   releaseCancellation=release;
  }
  // Immediate Main cancellation during registration precedes run(), so
  // commit the cancelled/zero-attempt terminal state without attempting a
  // preflight or replaying this approval. The API still reports no write.
  if(queue.snapshot().cancelled){
   await store.save(queue.checkpoint());
   throw new Error('Durable batch repair cancelled; fresh review required');
  }
  const final=await queue.run();
  if(final.items.length!==1||final.items[0]?.status!=='completed'||!written)
   throw new Error('Durable batch repair blocked or failed; fresh review required');
  return output as T;
 }finally{
  // A trusted Main control finalizer may itself fail. Always close the
  // checkpoint SQLite handle (especially on Windows) before releasing the
  // managed-script lease, and never surface private callback error text.
  let cleanupFailed=false;
  try{releaseCancellation();}catch{cleanupFailed=true;}
  try{store.close();}catch{cleanupFailed=true;}
  if(cleanupFailed)throw new Error('Durable batch cleanup failed; fresh review required');
 }
 }finally{
  // Error, aborted approval, crash-safe checkpoint failure or success must
  // never leave an in-process lease that blocks all future fresh approvals.
  releaseManagedScript();
 }
}
