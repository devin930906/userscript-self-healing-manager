import assert from 'node:assert/strict';
import {test} from 'node:test';

const binding={
 scanId:'scan-one',scriptId:'managed-one',itemIndex:0,selectorIndex:2,
 targetId:'target-one',pageUrl:'https://example.invalid/approved',
 frameId:'frame-one',loaderId:'loader-one',
};
async function gate(){
 // Dynamic import keeps RED attributable to the missing product capability,
 // rather than failing module resolution during test discovery.
 const api=await import('../src/manual-dom-transition.ts').catch(()=>({} as Record<string,unknown>));
 assert.equal(typeof (api as any).ManualDomTransitionGate,'function',
  'FR-025 two-stage manual observation gate is not implemented');
 return new (api as any).ManualDomTransitionGate();
}

test('FR-025 user-paced manual DOM transition binds first and second samples but never certifies V2/V3',async()=>{
 const service=await gate();
 const awaiting=service.begin({binding,beforeCount:1,now:1000});
 assert.equal(awaiting.status,'awaiting-user-action');
 assert.equal(awaiting.V2,'blocked');
 assert.equal(awaiting.V3,'not-configured');
 assert.equal(awaiting.functionalVerified,false);
 assert.equal(awaiting.interactionVerified,false);
 assert.equal(awaiting.beforeCount,1);
 const observed=service.finish({binding,afterCount:2,now:2000});
 assert.equal(observed.status,'changed-observed');
 assert.deepEqual([observed.beforeCount,observed.afterCount],[1,2]);
 assert.equal(observed.V2,'blocked');
 assert.equal(observed.V3,'not-configured');
 assert.equal(observed.managerVerified,false);
 assert.throws(()=>service.finish({binding,afterCount:3,now:2001}),/pending|expired|start/i,
  'one manual observation may only be completed once');
});

test('FR-025 manual transition reports unchanged read-only evidence without false causal attribution',async()=>{
 const service=await gate();
 service.begin({binding,beforeCount:0,now:500});
 const unchanged=service.finish({binding,afterCount:0,now:550});
 assert.equal(unchanged.status,'unchanged');
 assert.equal(unchanged.beforeCount,0);
 assert.equal(unchanged.afterCount,0);
 assert.equal(unchanged.interactionVerified,false);
 assert.equal(unchanged.functionalVerified,false);
});

test('FR-025 rejects changed script/selector/page/document, expiration and future-dated evidence',async()=>{
 for(const changed of [
  {scriptId:'other'}, {scanId:'other'}, {itemIndex:1},{selectorIndex:3},
  {targetId:'other'}, {pageUrl:'https://other.invalid/'},
  {frameId:'frame-other'}, {loaderId:'loader-other'},
 ]){
  const service=await gate();
  service.begin({binding,beforeCount:1,now:1000});
  assert.throws(()=>service.assertPending({...binding,...changed},2000),/identity|binding|stale|different/i,
   'a stale or retargeted witness must not authorize a second observation');
  assert.throws(()=>service.finish({binding:{...binding,...changed},afterCount:2,now:2000}),
   /identity|binding|stale|different/i);
 }
 for(const now of [999,61001,Number.NaN,Number.POSITIVE_INFINITY]){
  const service=await gate();
  service.begin({binding,beforeCount:1,now:1000});
  assert.throws(()=>service.finish({binding,afterCount:2,now}),/expired|time|invalid/i);
 }
});

test('FR-025 invalid counts, incomplete identity and malformed approval cannot open a manual observation',async()=>{
 const service=await gate();
 for(const beforeCount of [-1,5001,1.1,NaN]){
  assert.throws(()=>service.begin({binding,beforeCount,now:1000}),/count|invalid|budget/i);
 }
 for(const changed of [{scanId:''},{targetId:''},{frameId:''},{loaderId:''},{pageUrl:'data:text/html,private'},{scriptId:''}]){
  assert.throws(()=>service.begin({binding:{...binding,...changed},beforeCount:1,now:1000}),/binding|identity|invalid|scope/i);
 }
 assert.throws(()=>service.finish({binding,afterCount:1,now:1000}),/pending|start/i);
});

test('FR-025 pending manual observation is revocable; restart must not inherit prior evidence',async()=>{
 const service=await gate();
 service.begin({binding,beforeCount:1,now:1000});
 service.clear();
 assert.throws(()=>service.finish({binding,afterCount:2,now:1100}),/pending|start/i);
 service.begin({binding,beforeCount:3,now:2000});
 assert.equal(service.finish({binding,afterCount:4,now:3000}).beforeCount,3);
});
