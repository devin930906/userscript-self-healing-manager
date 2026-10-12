import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRepairTaskQueue} from '../src/repair-task-queue.ts';

const job=(id:string,execute:()=>Promise<void>=async()=>{})=>({id,scriptId:'script-'+id,approved:true,execute});

test('FR-029 checkpoint survives a simulated process restart without replaying completed or interrupted writes',async()=>{
 const invoked:string[]=[];
 const original=createRepairTaskQueue([
  job('done',async()=>{invoked.push('done');}),
  job('interrupted',async()=>{invoked.push('interrupted');throw new Error('PRIVATE SOURCE PATH');}),
 ]);
 const first=await original.run();
 assert.deepEqual(first.items.map(x=>x.status),['completed','failed']);
 const saved=(original as any).checkpoint();
 assert.equal(saved.version,1);
 assert.doesNotMatch(JSON.stringify(saved),/PRIVATE SOURCE PATH|execute|approved/);
 const replay:string[]=[];
 const restored=createRepairTaskQueue([
  job('done',async()=>{replay.push('REPLAYED_DONE');}),
  job('interrupted',async()=>{replay.push('REPLAYED_FAILED');}),
 ],{recovery:saved} as any);
 assert.deepEqual(restored.snapshot().items.map(x=>x.status),['completed','blocked']);
 assert.deepEqual(restored.snapshot().items.map(x=>x.attempts),[1,1]);
 await restored.run();
 await restored.retryFailed();
 assert.deepEqual(replay,[],'recovery cannot silently replay a completed or uncertain user write');
});

test('FR-029 interrupted running checkpoint remains blocked even with fresh in-memory task approval',async()=>{
 const persisted={version:1,items:[
  {id:'one',scriptId:'script-one',status:'running',attempts:1,errorCode:null},
  {id:'two',scriptId:'script-two',status:'queued',attempts:0,errorCode:null},
 ]};
 let count=0;
 const restored=createRepairTaskQueue([
  job('one',async()=>{count++;}),
  job('two',async()=>{count++;}),
 ],{recovery:persisted} as any);
 assert.deepEqual(restored.snapshot().items.map(x=>x.status),['blocked','blocked']);
 await restored.run();
 assert.equal(count,0);
});

test('FR-029 rejects corrupt, reordered, forged or privacy-contaminated recovery state',()=>{
 const tasks=[job('a'),job('b')];
 const valid={version:1,items:[
  {id:'a',scriptId:'script-a',status:'completed',attempts:1,errorCode:null},
  {id:'b',scriptId:'script-b',status:'failed',attempts:1,errorCode:'TASK_EXECUTION_FAILED'},
 ]};
 const tampered=[
  {...valid,version:2},
  {...valid,items:[...valid.items].reverse()},
  {...valid,items:[{...valid.items[0],scriptId:'different-file'},valid.items[1]]},
  {...valid,items:[{...valid.items[0],status:'newly-approved'},valid.items[1]]},
  {...valid,items:[{...valid.items[0],attempts:-1},valid.items[1]]},
  {...valid,items:[{...valid.items[0],details:'PRIVATE PAGE TOKEN'},valid.items[1]]},
  {...valid,items:[{...valid.items[0],errorCode:'PRIVATE SECRET'},valid.items[1]]},
  {...valid,items:valid.items.slice(0,1)},
 ];
 for(const state of tampered){
  assert.throws(()=>createRepairTaskQueue(tasks,{recovery:state} as any),
   /checkpoint|recovery|invalid|mismatch/i,'malformed recovery must fail closed');
 }
});

test('FR-029 persistence callback must complete before write, and after completion',async()=>{
 const order:string[]=[];
 const q=createRepairTaskQueue([job('one',async()=>{order.push('write');})],
  {onCheckpoint:async(checkpoint:any)=>{
   const status=checkpoint.items[0]?.status;
   order.push('persist:'+status);
   assert.equal(checkpoint.version,1);
  }} as any);
 await q.run();
 const written=order.indexOf('write');
 assert.ok(written>0);
 assert.equal(order[written-1],'persist:running');
 assert.ok(order.includes('persist:completed'));
});

test('FR-029 failed durable checkpoint blocks write and sanitizes persistence exception',async()=>{
 let called=0;
 const q=createRepairTaskQueue([job('one',async()=>{called++;})],
  {onCheckpoint:async()=>{throw new Error('PRIVATE PASSWORD RECOVERY PATH');}} as any);
 await assert.rejects(q.run(),error=>
  error instanceof Error&&/checkpoint|persist/i.test(error.message)&&
  !error.message.includes('PRIVATE PASSWORD RECOVERY PATH'));
 assert.equal(called,0);
});

test('FR-029 cancellation while awaiting a durable running checkpoint never invokes write',async()=>{
 let enter!:()=>void,finish!:()=>void;
 const started=new Promise<void>(resolve=>{enter=resolve;});
 const pending=new Promise<void>(resolve=>{finish=resolve;});
 let writes=0;
 const q=createRepairTaskQueue([job('one',async()=>{writes++;})],
  {onCheckpoint:async(state:any)=>{
   if(state.items[0]?.status==='running'){enter();await pending;}
  }} as any);
 const run=q.run();
 // A missing implementation must FAIL RED promptly, never hang an entire CI
 // worker waiting for a hook which old code never invokes.
 await Promise.race([started,new Promise<void>((_,reject)=>
  setTimeout(()=>reject(new Error('Expected durable running checkpoint was not called')),1000))]);
 q.cancel();
 finish();
 const end=await run;
 assert.equal(writes,0);
 assert.equal(end.items[0]?.status,'cancelled');
});
