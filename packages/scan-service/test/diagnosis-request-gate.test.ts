import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DiagnosisRequestGate} from '../src/diagnosis-request-gate.ts';
const key={scanId:'scan-a',targetId:'page-1'};
test('cancellation invalidates an in-flight page even if CDP resolves later',()=>{
 const gate=new DiagnosisRequestGate();
 const ticket=gate.begin({...key,offset:0});
 assert.equal(gate.isCurrent(ticket),true);
 gate.cancel(key);
 assert.equal(gate.isCurrent(ticket),false);
 assert.throws(()=>gate.assertCurrent(ticket),/cancel|stale|revoked/i);
 assert.throws(()=>gate.complete(ticket,{pageItems:25,totalItems:50}),/cancel|stale|revoked/i);
 assert.equal(gate.failIfCurrent(ticket),false);
});
test('duplicate concurrent CDP requests for same batch cannot produce duplicate persisted pages',()=>{
 const gate=new DiagnosisRequestGate();
 const ticket=gate.begin({...key,offset:0});
 assert.throws(()=>gate.begin({...key,offset:0}),/running|concurrent|active/i);
 assert.throws(()=>gate.begin({...key,offset:25}),/running|concurrent|active/i);
 gate.complete(ticket,{pageItems:25,totalItems:50});
 const second=gate.begin({...key,offset:25});
 assert.notEqual(ticket,second);
 assert.equal(gate.isCurrent(second),true);
 gate.complete(second,{pageItems:25,totalItems:50});
 assert.throws(()=>gate.begin({...key,offset:25}),/offset|order|start/i);
});
test('cancelled old page cannot invalidate newly restarted diagnosis for same target',()=>{
 const gate=new DiagnosisRequestGate();
 const old=gate.begin({...key,offset:0});
 gate.cancel(key);
 const latest=gate.begin({...key,offset:0});
 assert.equal(gate.isCurrent(latest),true);
 assert.equal(gate.failIfCurrent(old),false);
 assert.equal(gate.isCurrent(latest),true);
 gate.complete(latest,{pageItems:25,totalItems:25});
});
test('different targets are independent and replacing scan invalidates every old ticket',()=>{
 const gate=new DiagnosisRequestGate();
 const first=gate.begin({...key,offset:0});
 const second=gate.begin({scanId:'scan-a',targetId:'page-2',offset:0});
 gate.cancel(key);
 assert.equal(gate.isCurrent(second),true);
 gate.invalidateAll();
 assert.equal(gate.isCurrent(second),false);
 assert.equal(gate.failIfCurrent(first),false);
});
test('wrong order, total, invalid boundaries and page count fail before recording evidence',()=>{
 const gate=new DiagnosisRequestGate();
 assert.throws(()=>gate.begin({...key,offset:25}),/offset|order|start/i);
 const t=gate.begin({...key,offset:0});
 assert.throws(()=>gate.complete(t,{pageItems:24,totalItems:50}),/size|count|page/i);
 assert.throws(()=>gate.complete(t,{pageItems:25,totalItems:0}),/total|count|size/i);
 assert.equal(gate.failIfCurrent(t),true);
 assert.throws(()=>gate.begin({...key,offset:25}),/offset|order|start/i);
 const fresh=gate.begin({...key,offset:0});
 assert.throws(()=>gate.begin({scanId:'bad',targetId:'',offset:0}),/identity|target/i);
 gate.complete(fresh,{pageItems:1,totalItems:1});
});
