import assert from 'node:assert/strict';
import {test} from 'node:test';
import {suggestCandidateRepairs} from '../src/workflow.ts';
const locator={method:'querySelector',expression:'#save-old',runtimeRequired:false};
const target={id:'alpha',url:'https://example.org'};
const safeNodes=[{tagName:'BUTTON',attributes:{'data-testid':'save-button'}}];
const deps={
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
 const custom={probe:async(inputs:readonly typeof locator[])=>({...await deps.probe(inputs),checks:inputs.map(x=>({method:x.method,expression:x.expression,status:'found',matchCount:1}))}),capture:async()=>{snapshots++;return deps.capture();}};
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
 assert.equal(nested.status,'blocked-context');
 assert.equal(calls,0);
});
