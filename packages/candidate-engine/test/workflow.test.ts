import assert from 'node:assert/strict';
import {test} from 'node:test';
import {suggestCandidateRepairs} from '../src/workflow.ts';
const locator={method:'querySelector',expression:'#save-old',runtimeRequired:false};
const target={id:'alpha',url:'https://example.org'};
const confirmed=async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'main-frame',loaderId:'main-loader'});
const safeNodes=[{tagName:'BUTTON',attributes:{'data-testid':'save-button'}}];
const deps={
 confirm:confirmed,
 probe:async(inputs:readonly {method:string;expression:string;runtimeRequired:boolean}[])=>({targetId:'alpha',url:'https://example.org',checks:inputs.map(input=>({method:input.method,expression:input.expression,status:input.expression==='#save-old'?'missing':'found',matchCount:input.expression==='#save-old'?0:1}))}),
 capture:async()=>({targetId:'alpha',url:'https://example.org',scope:'top-document',nodes:safeNodes})
};
test('confirmed missing CSS locator produces uniquely live-verified read-only suggestions',async()=>{
 const result=await suggestCandidateRepairs({target,locator,deps});
 assert.equal(result.length,1);assert.equal(result[0]?.expression,'[data-testid="save-button"]');
 assert.equal(result[0]?.validationLevel,'dom-candidate-verified');assert.equal(result[0]?.approved,false);
});
test('present or runtime-bound original locator never triggers snapshot candidate generation',async()=>{
 let snapshots=0;
 const custom={confirm:confirmed,probe:async(inputs:readonly typeof locator[])=>({...await deps.probe(inputs),checks:inputs.map(x=>({method:x.method,expression:x.expression,status:'found',matchCount:1}))}),capture:async()=>{snapshots++;return deps.capture();}};
 assert.deepEqual(await suggestCandidateRepairs({target,locator,deps:custom}),[]);
 assert.equal(snapshots,0);
 assert.deepEqual(await suggestCandidateRepairs({target,locator:{...locator,runtimeRequired:true},deps}),[]);
});
test('stale page URL and identity are blocked before returning a candidate',async()=>{
 await assert.rejects(suggestCandidateRepairs({target,locator,deps:{...deps,capture:async()=>({...await deps.capture(),targetId:'changed'})}}),/identity/i);
 await assert.rejects(suggestCandidateRepairs({target,locator,deps:{...deps,probe:async inputs=>({...await deps.probe(inputs),url:'https://other.example'})}}),/identity/i);
});
test('rejects snapshot-only candidate that no longer matches exactly one live node',async()=>{
 const testDeps={...deps,probe:async(inputs:readonly typeof locator[])=>({...await deps.probe(inputs),checks:inputs.map(input=>({method:input.method,expression:input.expression,status:input.expression==='#save-old'?'missing':'ambiguous',matchCount:input.expression==='#save-old'?0:2}))})};
 assert.deepEqual(await suggestCandidateRepairs({target,locator,deps:testDeps}),[]);
});

test('name and class collection repairs require unique live CDP confirmation',async()=>{
 for(const method of ['getElementsByName','getElementsByClassName']){
  const value=method==='getElementsByName'?'new-field':'new-panel';
  const nodes=[{tagName:'INPUT',attributes:method==='getElementsByName'?{name:value}:{class:value}}];
  const locator={method,expression:'old-value',runtimeRequired:false};
  const proposed=await suggestCandidateRepairs({target,locator,deps:{
   confirm:confirmed,
   probe:async inputs=>({targetId:target.id,url:target.url,checks:inputs.map(x=>({
    method:x.method,expression:x.expression,status:x.expression==='old-value'?'missing':'found',
    matchCount:x.expression==='old-value'?0:1,
   }))}),
   capture:async()=>({targetId:target.id,url:target.url,scope:'top-document',nodes}),
  }});
  assert.deepEqual(proposed.map(x=>x.expression),[value]);
 }
});

test('versioned adapter role strictly filters DOM-confirmed repair candidates without auto-applying',async()=>{
 const {parseSiteAdapter}=await import('../src/site-adapter.ts');
 const {suggestAdapterScopedRepairs}=await import('../src/workflow.ts');
 const adapter=parseSiteAdapter({
  schemaVersion:1,siteId:'sample',version:'1.0.0',urlPatterns:['https://example.org/*'],
  states:{ready:{description:'Ready'}},
  roles:{'chat.sendButton':{
   contexts:[{stateId:'ready',frame:'top',shadow:'none'}],
   strategies:[{kind:'css',selector:'[data-testid="save-button"]',weight:100}],
   cardinality:{min:1,max:1},assertions:['unique'],
  }},
  validationCases:['SAVE_VISIBLE'],
 });
 const observed=await suggestAdapterScopedRepairs({
  target,locator,adapter,roleId:'chat.sendButton',observedStateId:'ready',
  deps:{...deps,capture:async()=>({...await deps.capture(),nodes:[
   {tagName:'BUTTON',attributes:{'data-testid':'save-button'}},
   {tagName:'BUTTON',attributes:{'data-testid':'different-button'}},
  ]})},
 });
 assert.equal(observed.status,'candidate-only');
 assert.deepEqual(observed.candidates.map(c=>c.cssSelector),['[data-testid="save-button"]']);
 assert.equal(observed.candidates[0]?.approved,false);
 assert.equal(observed.functionalVerified,false);
});
test('adapter-scoped candidate search never starts CDP for wrong origin or unresolved nested frame',async()=>{
 const {parseSiteAdapter}=await import('../src/site-adapter.ts');
 const {suggestAdapterScopedRepairs}=await import('../src/workflow.ts');
 const adapter=parseSiteAdapter({
  schemaVersion:1,siteId:'sample',version:'1.0.0',urlPatterns:['https://example.org/*'],
  states:{ready:{description:'Ready'}},
  roles:{'chat.sendButton':{
   contexts:[{stateId:'ready',frame:'iframe',shadow:'none'}],
   strategies:[{kind:'css',selector:'#new-button',weight:100}],
   cardinality:{min:1,max:1},assertions:['unique'],
  }},
  validationCases:['SAVE_VISIBLE'],
 });
 let calls=0;
 const blockedDeps={
  confirm:confirmed,
  probe:async()=>{calls++;throw Error('CDP must not be invoked for blocked role');},
  capture:async()=>{calls++;throw Error('DOM snapshot must not be invoked for blocked role');},
 };
 const denied=await suggestAdapterScopedRepairs({
  target:{id:'alpha',url:'https://other.example.org/'},locator,adapter,
  roleId:'chat.sendButton',observedStateId:'ready',deps:blockedDeps,
 });
 assert.equal(denied.status,'out-of-scope');
 const nested=await suggestAdapterScopedRepairs({
  target,locator,adapter,roleId:'chat.sendButton',observedStateId:'ready',deps:blockedDeps,
 });
 assert.equal(nested.status,'candidate-only');
 assert.equal(nested.rootScope,'iframe-document');
 assert.deepEqual(nested.candidates,[]);
 assert.equal(calls,0);
});

test('shadow-scoped SiteAdapter roles never reuse top-document candidate evidence',async()=>{
 const {parseSiteAdapter}=await import('../src/site-adapter.ts');
 const {suggestAdapterScopedRepairs}=await import('../src/workflow.ts');
 const adapter=parseSiteAdapter({
  schemaVersion:1,siteId:'sample',version:'1.0.0',urlPatterns:['https://example.org/*'],
  states:{ready:{description:'Ready'}},
  roles:{'chat.shadowButton':{
   contexts:[{stateId:'ready',frame:'top',shadow:'open'}],
   strategies:[{kind:'css',selector:'[data-testid="save-button"]',weight:100}],
   cardinality:{min:1,max:1},assertions:['unique'],
  }},validationCases:['SAVE_SHADOW'],
 });
 let cdpcalls=0;
 const blockedDeps={
  confirm:confirmed,
  probe:async()=>{cdpcalls++;throw Error('No top-document probe for a shadow-scoped role');},
  capture:async()=>{cdpcalls++;throw Error('No top-document snapshot for a shadow-scoped role');},
 };
 const result=await suggestAdapterScopedRepairs({
  target,locator,adapter,roleId:'chat.shadowButton',observedStateId:'ready',deps:blockedDeps,
 });
 assert.equal(result.rootScope,'open-shadow');
 assert.deepEqual(result.candidates,[]);
 assert.equal(result.functionalVerified,false);
 assert.equal(result.managerVerified,false);
 assert.equal(cdpcalls,0);
});

test('iframe-scoped SiteAdapter repair suggestions never use the top-document candidate workflow',async()=>{
 const {parseSiteAdapter}=await import('../src/site-adapter.ts');
 const {suggestAdapterScopedRepairs}=await import('../src/workflow.ts');
 const iframe=parseSiteAdapter({schemaVersion:1,siteId:'sample',version:'1.0.0',urlPatterns:['https://example.org/*'],
  states:{ready:{description:'Ready'}},
  roles:{'chat.iframeButton':{contexts:[{stateId:'ready',frame:'iframe',shadow:'none'}],
   strategies:[{kind:'css',selector:'#heal-button',weight:100}],cardinality:{min:1,max:1},assertions:['unique']}},
  validationCases:['IFRAME_EXISTS']});
 const ret=await suggestAdapterScopedRepairs({target,locator,adapter:iframe,roleId:'chat.iframeButton',
  observedStateId:'ready',deps:{confirm:confirmed,probe:async()=>{throw Error('Must not probe document')},
  capture:async()=>{throw Error('Must not capture document')}}});
 assert.equal(ret.rootScope,'iframe-document');
 assert.deepEqual(ret.candidates,[]);
 assert.equal(ret.functionalVerified,false);
});


test('candidate that stops being unique on repeated live probe is not recommended',async()=>{
 let candidateProbes=0;
 const unstable={...deps,probe:async(inputs:readonly typeof locator[])=>{
  const answer=await deps.probe(inputs);
  if(inputs[0]?.expression!==locator.expression){
   candidateProbes++;
   if(candidateProbes>=2)return {...answer,checks:answer.checks.map(check=>({...check,matchCount:2}))};
  }
  return answer;
 }};
 assert.deepEqual(await suggestCandidateRepairs({target,locator,deps:unstable}),[]);
 assert.equal(candidateProbes,2);
});


test('candidate verification keeps browser probe fanout bounded',async()=>{
 let calls=0;
 const budget={...deps,probe:async(inputs:readonly typeof locator[])=>{
  calls++;
  assert.ok(inputs.length<=10,'candidate probe budget must respect ranking maximum of 10');
  return deps.probe(inputs);
 }};
 const result=await suggestCandidateRepairs({target,locator,deps:budget});
 assert.ok(result.length>0);
 assert.equal(calls,5,'initial, pre-candidate, repeated candidate and final original checks');
});


test('recovered original selector suppresses obsolete candidate suggestions',async()=>{
 let originalChecks=0;
 const recovered={...deps,probe:async(inputs:readonly typeof locator[])=>{
  const result=await deps.probe(inputs);
  if(inputs.length===1&&inputs[0]?.expression===locator.expression){
   originalChecks++;
   if(originalChecks===3)return {...result,checks:[{method:locator.method,expression:locator.expression,status:'found',matchCount:1}]};
  }
  return result;
 }};
 assert.deepEqual(await suggestCandidateRepairs({target,locator,deps:recovered}),[]);
 assert.equal(originalChecks,3);
});


test('transient recovery after snapshot blocks candidate probes entirely',async()=>{
 let originalChecks=0,candidateChecks=0;
 const transient={...deps,probe:async(inputs:readonly typeof locator[])=>{
  const result=await deps.probe(inputs);
  if(inputs[0]?.expression!==locator.expression){candidateChecks++;return result;}
  originalChecks++;
  if(originalChecks===2)return {...result,checks:[{method:locator.method,expression:locator.expression,status:'found',matchCount:1}]};
  return result;
 }};
 assert.deepEqual(await suggestCandidateRepairs({target,locator,deps:transient}),[]);
 assert.equal(originalChecks,2);
 assert.equal(candidateChecks,0);
});


test('validated recommendation list never repeats the same selector expression',async()=>{
 const repeated={...deps,capture:async()=>({targetId:target.id,url:target.url,scope:'top-document',nodes:[
  {tagName:'BUTTON',attributes:{'data-testid':'save-button',id:'save-button'}},
 ]})};
 const suggestions=await suggestCandidateRepairs({target,locator,deps:repeated});
 assert.equal(new Set(suggestions.map(x=>x.expression)).size,suggestions.length);
 assert.ok(suggestions.length>0);
});

test('candidate inspection fails closed before CDP when required probe or capture is absent',async()=>{
 const missingProbe={confirm:confirmed,capture:deps.capture} as unknown as typeof deps;
 const missingCapture={confirm:confirmed,probe:deps.probe} as unknown as typeof deps;
 await assert.rejects(suggestCandidateRepairs({target,locator,deps:missingProbe}),/probe and snapshot/i);
 await assert.rejects(suggestCandidateRepairs({target,locator,deps:missingCapture}),/probe and snapshot/i);
});
