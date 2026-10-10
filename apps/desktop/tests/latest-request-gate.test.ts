import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LatestRequestGate} from '../src/renderer/latest-request-gate.ts';

test('stale earlier request cannot clear a newer request busy indicator',()=>{
 const gate=new LatestRequestGate();
 const events:string[]=[];
 const earlier=gate.begin();
 const newer=gate.begin();
 assert.equal(gate.commit(earlier,()=>events.push('stale finalizer')),false);
 assert.equal(gate.commit(newer,()=>events.push('new finalizer')),true);
 assert.deepEqual(events,['new finalizer']);
});
test('changing target invalidates pending response, error, and finally callbacks',()=>{
 const gate=new LatestRequestGate();
 const earlier=gate.begin();
 gate.invalidate();
 const state={result:'new target',error:'',busy:false};
 assert.equal(gate.commit(earlier,()=>{state.result='old target';}),false);
 assert.equal(gate.commit(earlier,()=>{state.error='old error';}),false);
 assert.equal(gate.commit(earlier,()=>{state.busy=true;}),false);
 assert.deepEqual(state,{result:'new target',error:'',busy:false});
});
test('an ordinary current request still commits exactly once per callback',()=>{
 const gate=new LatestRequestGate();
 const current=gate.begin();
 let count=0;
 assert.equal(gate.commit(current,()=>{count++;}),true);
 assert.equal(gate.commit(current,()=>{count++;}),true);
 assert.equal(count,2);
});
test('request epochs are monotonically increasing and cannot be reused after cancellation',()=>{
 const gate=new LatestRequestGate();
 const first=gate.begin();gate.invalidate();const second=gate.begin();
 assert.ok(second>first);
 assert.equal(gate.isCurrent(first),false);
 assert.equal(gate.isCurrent(second),true);
});
