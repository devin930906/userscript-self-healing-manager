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
