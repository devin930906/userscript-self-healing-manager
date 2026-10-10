import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BatchPauseGate} from '../src/pause-gate.ts';

test('pause blocks pending work until an explicit resume, without busy polling',async()=>{
 const gate=new BatchPauseGate();
 assert.equal(gate.pause(),true);
 let settled=false;
 const pending=gate.waitUntilReady().then(result=>{settled=true;return result;});
 await Promise.resolve();
 assert.equal(settled,false);
 gate.resume();
 assert.equal(await pending,true);
 assert.equal(gate.isPaused,false);
});
test('cancellation wakes paused jobs and prevents future work',async()=>{
 const gate=new BatchPauseGate();
 gate.pause();
 const waiting=gate.waitUntilReady();
 gate.cancel();
 assert.equal(await waiting,false);
 assert.equal(await gate.waitUntilReady(),false);
 assert.equal(gate.pause(),false);
 assert.equal(gate.isCancelled,true);
});
test('resume before waiter attaches cannot leave a job stuck',async()=>{
 const gate=new BatchPauseGate();
 gate.pause();gate.resume();
 assert.equal(await gate.waitUntilReady(),true);
});

test('rapid resume then pause cannot accidentally release the next batch',async()=>{
 const gate=new BatchPauseGate();
 gate.pause();
 let released=false;
 const waiting=gate.waitUntilReady().then(value=>{released=true;return value;});
 gate.resume();
 gate.pause();
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(released,false,'a new pause must be observed before dispatch');
 gate.resume();
 assert.equal(await waiting,true);
});
