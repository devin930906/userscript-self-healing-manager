import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runReadOnlyDomContract} from '../src/index.ts';

const target={id:'valid-target',type:'page',url:'https://fixture.example.test/',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/valid-target'};
const frame={targetId:target.id,confirmedUrl:target.url,frameId:'frame-1',loaderId:'loader-1'};
function evidence(method:string,expression:string,status:string,matchCount:number){
 return {targetId:target.id,url:target.url,validationLevel:'dom-only',
  checks:[{method,expression,status,matchCount,nodeFingerprint:'b'.repeat(64)}]};
}
function request(method:string,expression:string,observed:any,expectation:'exists'|'unique'='exists'){
 return {approved:true,target,caseId:'QA-V1-CARDINALITY',expectation,
  locator:{method,expression,runtimeRequired:false},
  deps:{confirm:async()=>frame,probe:async()=>observed,wait:async()=>{}},
 };
}

test('V1 querySelector cannot pass with physically impossible multiple elements',async()=>{
 const e=evidence('querySelector','#button','found',2);
 const out=await runReadOnlyDomContract(request('querySelector','#button',e));
 assert.equal(out.status,'needs-review');
 assert.equal(out.matchCount,null);
});
test('V1 getElementById cannot pass with ambiguous or multi-node evidence',async()=>{
 for(const [status,count] of [['found',4],['ambiguous',1]] as const){
  const e=evidence('getElementById','checkoutButton',status,count);
  const out=await runReadOnlyDomContract(request('getElementById','checkoutButton',e));
  assert.equal(out.status,'needs-review');
 }
});
test('a contradictory status missing with nonzero count cannot establish V1 presence',async()=>{
 const e=evidence('querySelector','#safe','missing',1);
 const out=await runReadOnlyDomContract(request('querySelector','#safe',e));
 assert.equal(out.status,'needs-review');
});
test('collection selectors still support a valid exists assertion for 2+ matching nodes',async()=>{
 const e=evidence('querySelectorAll','.rows','ambiguous',3);
 const out=await runReadOnlyDomContract(request('querySelectorAll','.rows',e));
 assert.equal(out.status,'passed');
 assert.equal(out.matchCount,3);
 assert.equal(out.V2,'blocked');
 assert.equal(out.functionalVerified,false);
});
