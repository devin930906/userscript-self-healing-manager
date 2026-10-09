import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runReadOnlyDomContract} from '../src/index.ts';

const target={type:'page',id:'fixture',url:'https://example.org/page',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fixture'};
const locator={method:'querySelector',expression:'#action',runtimeRequired:false};
function sample(status:'found'|'missing'|'ambiguous'|'blocked',count:number|null){
 return {targetId:target.id,url:target.url,validationLevel:'dom-only' as const,checks:[{method:locator.method,expression:locator.expression,status,matchCount:count}]};
}
function deps(checks:ReturnType<typeof sample>[],loaderIds:string[]=['a','a','a','a','a']){
 let scans=0,identities=0,waits=0;
 return {
  confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'frame',loaderId:loaderIds[Math.min(identities++,loaderIds.length-1)]}),
  probe:async()=>{const next=checks[scans++];if(!next)throw new Error('Too many probes');return next;},
  wait:async()=>{waits++;},
  counts:()=>({scans,identities,waits}),
 };
}
const request=(expectation:'exists'|'unique'='unique')=>({
 approved:true as const,target,caseId:'SCRIPT_1:LOCATOR_1',
 locator,expectation,
});
test('unique DOM contract requires two stable one-node observations, and never claims V3/V4',async()=>{
 const tools=deps([sample('found',1),sample('found',1)]);
 const result=await runReadOnlyDomContract({...request(),deps:tools});
 assert.equal(result.status,'passed');
 assert.equal(result.evidenceLevel,'V1');
 assert.equal(result.V2,'blocked');
 assert.equal(result.V3,'not-configured');
 assert.equal(result.V4,'not-configured');
 assert.equal(result.functionalVerified,false);
 assert.equal(result.managerVerified,false);
 assert.equal(result.attempts,2);
 assert.deepEqual(tools.counts().scans,2);
 assert.equal(tools.counts().waits,1);
});
test('exists contract allows multiple matches; unique contract must reject same evidence',async()=>{
 const many=[sample('found',3),sample('found',3)];
 const exists=await runReadOnlyDomContract({...request('exists'),deps:deps(many)});
 assert.equal(exists.status,'passed');
 assert.equal(exists.matchCount,3);
 const unique=await runReadOnlyDomContract({...request('unique'),deps:deps(many)});
 assert.equal(unique.status,'failed');
 assert.match(unique.reason,/unique|multiple|唯一|multiple/i);
});
test('stable missing is a failed DOM-only assertion and does not establish business failure',async()=>{
 const result=await runReadOnlyDomContract({...request(),deps:{...deps([sample('missing',0),sample('missing',0)]),summarize:async()=>({targetId:target.id,url:target.url,authorShadowTreeNodes:0})}});
 assert.equal(result.status,'failed');
 assert.equal(result.V3,'not-configured');
});
test('changing match count between samples must return needs-review, not pass/fail',async()=>{
 const result=await runReadOnlyDomContract({...request(),deps:deps([sample('missing',0),sample('found',1)])});
 assert.equal(result.status,'needs-review');
 assert.equal(result.matchCount,null);
});
test('same-URL Frame/Loader navigation refuses all stale evidence even when both would pass',async()=>{
 const tools=deps([sample('found',1),sample('found',1)],['a','a','a','b']);
 await assert.rejects(runReadOnlyDomContract({...request(),deps:tools}),/document|loader|identity|navigation/i);
});
test('CDP read error or malformed observation is never a pass',async()=>{
 const failed=deps([sample('found',1)]);
 const disconnected=await runReadOnlyDomContract({...request(),deps:{
  ...failed,probe:async()=>{throw new Error('CDP disconnected');},
 }});
 assert.equal(disconnected.status,'needs-review');
 const malformed=deps([sample('found',1),{...sample('found',1),targetId:'wrong'}]);
 const invalid=await runReadOnlyDomContract({...request(),deps:malformed});
 assert.equal(invalid.status,'needs-review');
});
test('invalid permissions, runtime or non-document locators cannot be tested',async()=>{
 const okay=deps([sample('found',1),sample('found',1)]);
 await assert.rejects(runReadOnlyDomContract({...request(),approved:false,deps:okay}),/approval|consent/i);
 await assert.rejects(runReadOnlyDomContract({...request(),caseId:'',deps:okay}),/id|case/i);
 await assert.rejects(runReadOnlyDomContract({...request(),locator:{...locator,runtimeRequired:true},deps:okay}),/static|runtime|literal/i);
 await assert.rejects(runReadOnlyDomContract({...request(),locator:{method:'querySelector',expression:'',runtimeRequired:false},deps:okay}),/selector|literal|locator/i);
});

test('ShadowRoot-only selector is inconclusive in a top-document DOM contract',async()=>{
 const safe={...deps([sample('missing',0),sample('missing',0)]),
  summarize:async()=>({targetId:target.id,url:target.url,authorShadowTreeNodes:2})};
 const result=await runReadOnlyDomContract({...request(),deps:safe});
 assert.equal(result.status,'needs-review');
 assert.equal(result.matchCount,null);
 assert.match(result.reason,/shadow/i);
});
test('nested iframe can hide a missing top-document selector, so no definitive failure is allowed',async()=>{
 const safe={...deps([sample('missing',0),sample('missing',0)]),
  confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'frame',loaderId:'a',subframeCount:1}),
  summarize:async()=>({targetId:target.id,url:target.url,authorShadowTreeNodes:0})};
 const result=await runReadOnlyDomContract({...request(),deps:safe});
 assert.equal(result.status,'needs-review');
 assert.match(result.reason,/iframe/i);
});
test('unknown ShadowRoot context, including missing or malformed evidence, cannot prove locator absence',async()=>{
 for(const summarize of [undefined,async()=>{throw Error('snapshot failed');},
  async()=>({targetId:target.id,url:target.url,authorShadowTreeNodes:-1})]){
  const tools={...deps([sample('missing',0),sample('missing',0)]),...(summarize?{summarize}:{})};
  const result=await runReadOnlyDomContract({...request(),deps:tools});
  assert.equal(result.status,'needs-review');
  assert.equal(result.matchCount,null);
 }
});
test('context inspection is bounded by Chrome Frame/Loader identity',async()=>{
 let loader='stable';
 const tools={...deps([sample('missing',0),sample('missing',0)]),
  confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'frame',loaderId:loader}),
  summarize:async()=>{loader='reload';return {targetId:target.id,url:target.url,authorShadowTreeNodes:0};}};
 await assert.rejects(runReadOnlyDomContract({...request(),deps:tools}),/document|loader|identity/i);
});
