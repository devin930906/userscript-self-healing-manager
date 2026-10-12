import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeDurableApprovedBatchSet} from '../src/main/durable-batch-set.ts';
import {openRepairCheckpointStore} from '../../../packages/scan-service/src/repair-checkpoint-store.ts';

async function fixture(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-multi-batch-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
function items(){
 return ['a','b','c'].map(name=>({
  approvalId:randomUUID(),scriptId:'managed-'+name,approved:true as boolean,preflight:async()=>true,
  write:async()=>{},
 }));
}
function persisted(root:string,groupId:string,tasks:readonly {approvalId:string;scriptId:string}[]){
 const store=openRepairCheckpointStore(join(root,'repair-queue',groupId+'.sqlite'));
 try{return store.load(tasks.map(t=>({id:t.approvalId,scriptId:t.scriptId})))?.items.map(row=>[row.status,row.attempts]);}
 finally{store.close();}
}
test('FR-030 three independently reviewed managed scripts run serially, failure is isolated and all states durable',async()=>fixture(async root=>{
 const groupId=randomUUID(),tasks=items(),order:string[]=[];
 let concurrent=0,max=0;
 tasks.forEach((task,i)=>{
  task.write=async()=>{
   concurrent++;max=Math.max(max,concurrent);order.push(task.scriptId);
   await Promise.resolve();concurrent--;
   if(i===1)throw Error('PRIVATE_USER_SOURCE_TEXT_AND_PATH');
  };
 });
 const output=await executeDurableApprovedBatchSet({dataRoot:root,groupId,items:tasks});
 assert.deepEqual(order,['managed-a','managed-b','managed-c']);
 assert.equal(max,1,'no two managed writes may run concurrently');
 assert.deepEqual(output,{queued:0,running:0,completed:2,failed:1,blocked:0,cancelled:0});
 assert.deepEqual(persisted(root,groupId,tasks),[['completed',1],['failed',1],['completed',1]]);
 const disk=await readFile(join(root,'repair-queue',groupId+'.sqlite'));
 for(const secret of ['PRIVATE_USER_SOURCE_TEXT_AND_PATH','managed-a','managed-b',tasks[0]!.approvalId,groupId])
  assert.equal(disk.includes(Buffer.from(secret)),false,'journal must never store raw task identity or callback exceptions');
}));

test('FR-030 user-selected stop-on-failure cancels remaining queued writes without rolling back prior completion',async()=>fixture(async root=>{
 const groupId=randomUUID(),tasks=items(),calls:string[]=[];
 tasks.forEach((task,i)=>{task.write=async()=>{calls.push(task.scriptId);if(i===1)throw Error('SECRET');};});
 const output=await executeDurableApprovedBatchSet({dataRoot:root,groupId,items:tasks,stopOnFailure:true});
 assert.deepEqual(calls,['managed-a','managed-b']);
 assert.deepEqual(output,{queued:0,running:0,completed:1,failed:1,blocked:0,cancelled:1});
 assert.deepEqual(persisted(root,groupId,tasks),[['completed',1],['failed',1],['cancelled',0]]);
}));

test('FR-030 denied per-script preflight blocks only that script; other approvals remain independently executable',async()=>fixture(async root=>{
 const groupId=randomUUID(),tasks=items(),calls:string[]=[];
 tasks[1]!.preflight=async()=>false;
 tasks.forEach(task=>{task.write=async()=>{calls.push(task.scriptId);};});
 const output=await executeDurableApprovedBatchSet({dataRoot:root,groupId,items:tasks});
 assert.deepEqual(calls,['managed-a','managed-c']);
 assert.deepEqual(output,{queued:0,running:0,completed:2,failed:0,blocked:1,cancelled:0});
 assert.deepEqual(persisted(root,groupId,tasks),[['completed',1],['blocked',0],['completed',1]]);
}));

test('FR-030 group UUID cannot replay any old approval, including previously failed tasks',async()=>fixture(async root=>{
 const groupId=randomUUID(),tasks=items();
 let executed=0;
 tasks.forEach(task=>{task.write=async()=>{executed++;};});
 await executeDurableApprovedBatchSet({dataRoot:root,groupId,items:tasks});
 await assert.rejects(executeDurableApprovedBatchSet({dataRoot:root,groupId,items:tasks}),/checkpoint|review|unavailable|replay/i);
 assert.equal(executed,3,'a previous group approval cannot trigger a second write');
}));

test('FR-030 duplicate script identities and unreviewed inputs fail before any durable reservation or dispatch',async()=>fixture(async root=>{
 const tasks=items();
 const invalidSets=[
  [tasks[0]!,{...tasks[1]!,scriptId:tasks[0]!.scriptId}],
  [tasks[0]!,{...tasks[1]!,approvalId:tasks[0]!.approvalId}],
  [tasks[0]!,{...tasks[1]!,scriptId:'../PRIVATE'}],
  [tasks[0]!,{...tasks[1]!,approved:false}],
 ];
 let writes=0;
 tasks.forEach(t=>{t.write=async()=>{writes++;};});
 for(const set of invalidSets){
  await assert.rejects(executeDurableApprovedBatchSet({dataRoot:root,groupId:randomUUID(),items:set}),/invalid|duplicate|identity|approved/i);
 }
 assert.equal(writes,0);
}));

test('FR-030 Main cancellation during a pending preflight stops all queued tasks without starting any write',async()=>fixture(async root=>{
 const groupId=randomUUID(),tasks=items();
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const hold=new Promise<void>(resolve=>{release=resolve;});
 let cancel!:()=>void,writes=0;
 tasks[0]!.preflight=async()=>{entered();await hold;return true;};
 tasks.forEach(t=>{t.write=async()=>{writes++;};});
 const pending=executeDurableApprovedBatchSet({dataRoot:root,groupId,items:tasks,
  onRegisterControls:controls=>{cancel=controls.cancel;return ()=>{};},
 });
 await started;cancel();release();
 const output=await pending;
 assert.equal(writes,0);
 assert.deepEqual(output,{queued:0,running:0,completed:0,failed:0,blocked:0,cancelled:3});
 assert.deepEqual(persisted(root,groupId,tasks),[['cancelled',1],['cancelled',0],['cancelled',0]]);
}));


test('FR-030 revoking the next independent approval mid-batch blocks that write while other jobs proceed',async()=>fixture(async root=>{
 const groupId=randomUUID(),tasks=items(),calls:string[]=[];
 tasks[0]!.write=async()=>{calls.push('a');tasks[1]!.approved=false;};
 tasks[1]!.write=async()=>{calls.push('b');};
 tasks[2]!.write=async()=>{calls.push('c');};
 const result=await executeDurableApprovedBatchSet({dataRoot:root,groupId,items:tasks});
 assert.deepEqual(calls,['a','c'],'revocation of a reviewed job must survive the initial batch snapshot');
 assert.deepEqual(result,{queued:0,running:0,completed:2,failed:0,blocked:1,cancelled:0});
 assert.deepEqual(persisted(root,groupId,tasks),[['completed',1],['blocked',1],['completed',1]]);
}));

test('FR-030 revocation during asynchronous Main preflight cannot authorize a stale managed write',async()=>fixture(async root=>{
 const groupId=randomUUID(),tasks=items();
 let entered!:()=>void,finish!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const release=new Promise<void>(resolve=>{finish=resolve;});
 let writes=0;
 tasks[0]!.preflight=async()=>{entered();await release;return true;};
 tasks[0]!.write=async()=>{writes++;};
 const pending=executeDurableApprovedBatchSet({dataRoot:root,groupId,items:tasks});
 await started;
 tasks[0]!.approved=false;
 finish();
 const result=await pending;
 assert.equal(writes,0,'stale asynchronous approval must not dispatch any managed write');
 assert.deepEqual(result,{queued:0,running:0,completed:2,failed:0,blocked:1,cancelled:0});
 assert.deepEqual(persisted(root,groupId,tasks),[['blocked',1],['completed',1],['completed',1]]);
}));
