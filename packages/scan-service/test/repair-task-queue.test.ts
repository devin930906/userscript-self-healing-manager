import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRepairTaskQueue} from '../src/repair-task-queue.ts';

test('approved repair queue is sequential and isolates item failure without auto retry',async()=>{
 const started:string[]=[];
 let active=0,maxActive=0;
 const tasks=['a','b','c'].map(id=>({
  id,scriptId:id+'.user.js',approved:true,
  execute:async()=>{
   active++;maxActive=Math.max(maxActive,active);started.push(id);
   await Promise.resolve();active--;
   if(id==='b')throw new Error('SECRET_PAGE_BODY_EXPOSED');
  },
 }));
 const snapshots:any[]=[];
 const queue=createRepairTaskQueue(tasks,{onProgress:state=>snapshots.push(state)});
 const result=await queue.run();
 assert.deepEqual(started,['a','b','c']);
 assert.equal(maxActive,1);
 assert.deepEqual(result.items.map(i=>[i.id,i.status,i.attempts]),[
  ['a','completed',1],['b','failed',1],['c','completed',1],
 ]);
 assert.equal(result.cancelled,false);
 assert.ok(snapshots.length>0);
 assert.doesNotMatch(JSON.stringify(snapshots),/SECRET_PAGE_BODY_EXPOSED/);
 assert.equal((await queue.run()).items[0]?.attempts,1,'completed jobs must not silently execute again');
});

test('unapproved repairs are blocked and never execute even on retry',async()=>{
 let called=0;
 const queue=createRepairTaskQueue([
  {id:'approved',scriptId:'a',approved:true,execute:async()=>{called++;}},
  {id:'denied',scriptId:'b',approved:false,execute:async()=>{throw new Error('unapproved execution');}},
 ]);
 let result=await queue.run();
 assert.equal(called,1);
 assert.deepEqual(result.items.map(i=>i.status),['completed','blocked']);
 result=await queue.retryFailed();
 assert.equal(called,1);
 assert.equal(result.items[1]?.status,'blocked');
});

test('repair queue pausing after first item gates dispatch until resume',async()=>{
 let releaseFirst!:()=>void;
 const firstStarted=new Promise<void>(resolve=>{releaseFirst=resolve;});
 const called:string[]=[];
 const queue=createRepairTaskQueue(['a','b','c'].map(id=>({
  id,scriptId:id,approved:true,execute:async()=>{
   called.push(id);
   if(id==='a'){queue.pause();releaseFirst();}
  },
 })));
 const pending=queue.run();
 await firstStarted;
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.deepEqual(called,['a']);
 assert.equal(queue.snapshot().paused,true);
 queue.resume();
 const result=await pending;
 assert.deepEqual(called,['a','b','c']);
 assert.equal(result.running,false);
});

test('cancellation during a running repair records its completion but never starts another write',async()=>{
 let start!:()=>void,complete!:()=>void;
 const entered=new Promise<void>(resolve=>{start=resolve;});
 const blocked=new Promise<void>(resolve=>{complete=resolve;});
 const called:string[]=[];
 const queue=createRepairTaskQueue(['a','b'].map(id=>({
  id,scriptId:id,approved:true,
  execute:async()=>{called.push(id);if(id==='a'){start();await blocked;}},
 })));
 const run=queue.run();
 await entered;
 queue.cancel();
 complete();
 const outcome=await run;
 assert.deepEqual(called,['a']);
 assert.equal(outcome.cancelled,true);
 assert.deepEqual(outcome.items.map(i=>i.status),['completed','cancelled'],
  'a completed in-flight write must never be misreported as rolled back');
 await assert.rejects(queue.run(),/cancel/i);
});

test('retryFailed only replays failed and explicitly approved jobs, not successful jobs',async()=>{
 const calls:Record<string,number>={a:0,b:0};
 const queue=createRepairTaskQueue(['a','b'].map(id=>({
  id,scriptId:id,approved:true,execute:async()=>{
   calls[id]=(calls[id]??0)+1;
   if(id==='a'&&calls[id]===1)throw new Error('transient failure');
  },
 })));
 await queue.run();
 assert.deepEqual(calls,{a:1,b:1});
 const replay=await queue.retryFailed();
 assert.deepEqual(calls,{a:2,b:1});
 assert.deepEqual(replay.items.map(i=>[i.status,i.attempts]),[['completed',2],['completed',1]]);
 assert.deepEqual((await queue.retryFailed()).items.map(i=>i.attempts),[2,1]);
});

test('repair queue rejects duplicate identities, invalid task budgets and concurrent execution',async()=>{
 const action=async()=>{};
 for(const input of [
  [{id:'dup',scriptId:'a',approved:true,execute:action},{id:'dup',scriptId:'b',approved:true,execute:action}],
  [{id:'x',scriptId:'',approved:true,execute:action}],
  [{id:'x',scriptId:'s',approved:undefined,execute:action}],
  Array.from({length:1001},(_,i)=>({id:String(i),scriptId:'s'+i,approved:true,execute:action})),
 ]){
  assert.throws(()=>createRepairTaskQueue(input as any),/invalid|duplicate|limit|approval|budget/i);
 }
 let release!:()=>void,start!:()=>void;
 const entered=new Promise<void>(resolve=>{start=resolve;});
 const held=new Promise<void>(resolve=>{release=resolve;});
 const queue=createRepairTaskQueue([{id:'one',scriptId:'a',approved:true,execute:async()=>{start();await held;}}]);
 const task=queue.run();
 await entered;
 await assert.rejects(queue.run(),/running|concurrent|active/i);
 release();await task;
});

test('queue pins reviewed repair operations and script identities before asynchronous dispatch',async()=>{
 const invoked:string[]=[];
 const tasks=[{
  id:'approved-original',scriptId:'script-A',approved:true,
  execute:async()=>{invoked.push('reviewed');},
 }];
 const queue=createRepairTaskQueue(tasks);
 const original=queue.snapshot();
 tasks[0]!.execute=async()=>{invoked.push('SUBSTITUTED_UNREVIEWED_WRITE');};
 tasks[0]!.scriptId='script-B';
 tasks.push({id:'injected',scriptId:'script-C',approved:true,execute:async()=>{invoked.push('INJECTED');}});
 const finished=await queue.run();
 assert.deepEqual(invoked,['reviewed'],'later mutations cannot change the operation reviewed at queue creation');
 assert.deepEqual(finished.items.map(i=>[i.id,i.scriptId]),[['approved-original','script-A']]);
 assert.deepEqual(original.items.map(i=>[i.id,i.scriptId]),[['approved-original','script-A']]);
});
test('revoking approval on a queued repair before dispatch blocks it without reauthorizing others',async()=>{
 let called=0;
 const task={id:'one',scriptId:'script-A',approved:true,execute:async()=>{called++;}};
 const queue=createRepairTaskQueue([task]);
 task.approved=false;
 const result=await queue.run();
 assert.equal(called,0);
 assert.equal(result.items[0]?.status,'blocked');
});

test('cancelling in the queued-to-running transition cannot start an unapproved write',async()=>{
 let called=0;
 let queue!:ReturnType<typeof createRepairTaskQueue>;
 queue=createRepairTaskQueue([
  {id:'one',scriptId:'one',approved:true,execute:async()=>{called++;}},
 ],{onProgress:state=>{
  if(state.items[0]?.status==='running')queue.cancel();
 }});
 const outcome=await queue.run();
 assert.equal(called,0);
 assert.equal(outcome.cancelled,true);
 assert.equal(outcome.items[0]?.status,'cancelled');
});

test('revoking approval during progress notification blocks dispatch before callback invocation',async()=>{
 let called=0;
 const original={id:'one',scriptId:'one',approved:true,execute:async()=>{called++;}};
 const queue=createRepairTaskQueue([original],{onProgress:state=>{
  if(state.items[0]?.status==='running')original.approved=false;
 }});
 const outcome=await queue.run();
 assert.equal(called,0);
 assert.equal(outcome.items[0]?.status,'blocked');
});

test('per-item asynchronous pre-dispatch gate can block unsafe writes without interrupting unrelated jobs',async()=>{
 const invoked:string[]=[];
 const approved:string[]=[];
 const tasks=['a','b','c'].map(id=>({
  id,scriptId:id,approved:true,execute:async()=>{invoked.push(id);},
 }));
 const q=createRepairTaskQueue(tasks,{
  beforeDispatch:async row=>{
   approved.push(row.id);
   if(row.id==='b')throw new Error('PRIVATE ORIGINAL HASH MISMATCH');
   return row.id!=='c';
  },
 });
 const output=await q.run();
 assert.deepEqual(approved,['a','b','c']);
 assert.deepEqual(invoked,['a']);
 assert.deepEqual(output.items.map(x=>x.status),['completed','blocked','blocked']);
 assert.doesNotMatch(JSON.stringify(output),/PRIVATE ORIGINAL HASH MISMATCH/);
});

test('cancellation during asynchronous pre-dispatch verification never calls the write callback',async()=>{
 let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;});
 const held=new Promise<void>(resolve=>{release=resolve;});
 let executed=0;
 const q=createRepairTaskQueue([{id:'one',scriptId:'a',approved:true,
  execute:async()=>{executed++;},
 }],{beforeDispatch:async()=>{entered();await held;return true;}});
 const work=q.run();
 await ready;
 q.cancel();release();
 const outcome=await work;
 assert.equal(executed,0);
 assert.equal(outcome.cancelled,true);
 assert.equal(outcome.items[0]?.status,'cancelled');
});

test('pre-dispatch callback is pinned against caller mutation and cannot broaden task authority',async()=>{
 let executed=0;
 const options={beforeDispatch:async()=>false};
 const q=createRepairTaskQueue([{id:'one',scriptId:'a',approved:true,
  execute:async()=>{executed++;},
 }],options);
 options.beforeDispatch=async()=>true;
 const result=await q.run();
 assert.equal(executed,0);
 assert.equal(result.items[0]?.status,'blocked');
});
