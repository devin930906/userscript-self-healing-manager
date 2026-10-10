import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runReadOnlyInteractionReadiness} from '../src/read-only-interaction-readiness.ts';

const target={type:'page',id:'fixture',url:'https://example.org/authorized',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fixture'};
const locator={method:'querySelector',expression:'#action',runtimeRequired:false};
const identity={targetId:target.id,confirmedUrl:target.url,frameId:'frame',loaderId:'original',subframeCount:0};
const digest='a'.repeat(64);
const probe=(fingerprint=digest,count=1)=>({
 targetId:target.id,url:target.url,validationLevel:'dom-only' as const,
 checks:[{method:locator.method,expression:locator.expression,
  status:count===1?'found':'missing',matchCount:count,nodeFingerprint:fingerprint}],
});
const visible=(update={})=>({
 targetId:target.id,url:target.url,validationLevel:'css-box-read-only' as const,
 status:'potentially-visible',matchCount:1,pointerBlocked:false,
 controlBlocker:'none-detected',interactionVerified:false,
 V2:'blocked',V3:'not-configured',V4:'not-configured',
 ...update,
});
const listener=(update={})=>({
 targetId:target.id,url:target.url,validationLevel:'direct-event-listener-read-only' as const,
 status:'registered',listenerCount:1,eventType:'click',interactionVerified:false,
 V2:'blocked',V3:'not-configured',V4:'not-configured',
 ...update,
});
function deps(options:{fingerprints?:string[];visibility?:object;listeners?:object;loaderIds?:string[];throwOn?:string}={}){
 let probes=0,visibilityCalls=0,listenerCalls=0,confirms=0;
 const calls:string[]=[];
 return {
  calls,
  confirm:async()=>{calls.push('confirm');const loaderId=options.loaderIds?.[confirms++]??identity.loaderId;return {...identity,loaderId};},
  probe:async()=>{calls.push('probe');probes++;if(options.throwOn==='probe')throw new Error('private-data');return probe(options.fingerprints?.[probes-1]??digest);},
  inspectVisibility:async()=>{calls.push('visibility');visibilityCalls++;if(options.throwOn==='visibility')throw new Error('private-path');return visible(options.visibility);},
  inspectListeners:async()=>{calls.push('listeners');listenerCalls++;if(options.throwOn==='listeners')throw new Error('secret');return listener(options.listeners);},
  wait:async()=>{calls.push('wait');},
 };
}
const request=(d=deps())=>({approved:true,target,locator,caseId:'AUTH:BUTTON',deps:d});
test('stable pinned DOM identity + clear direct blockers + direct click listener is only read-only potentially-ready, never V2',async()=>{
 const d=deps();
 const x=await runReadOnlyInteractionReadiness(request(d));
 assert.equal(x.status,'potentially-ready');
 assert.equal(x.evidenceLevel,'V1+read-only-control-metadata');
 assert.equal(x.V2,'blocked');
 assert.equal(x.V3,'not-configured');
 assert.equal(x.V4,'not-configured');
 assert.equal(x.interactionVerified,false);
 assert.equal(x.functionalVerified,false);
 assert.equal(x.managerVerified,false);
 assert.equal(x.samples,2);
 assert.equal(x.directClickListeners,1);
 assert.deepEqual(d.calls.filter(v=>v==='probe'),['probe','probe','probe','probe']);
 assert.equal(d.calls.filter(v=>v==='visibility').length,2);
 assert.equal(d.calls.filter(v=>v==='listeners').length,2);
 assert.ok(d.calls.filter(v=>v==='confirm').length>=8);
});
test('disabled, readonly, aria-disabled, pointer-blocked or hidden control fails readiness without pretending click test',async()=>{
 for(const v of [
  {controlBlocker:'disabled-attribute'},{controlBlocker:'readonly-attribute'},
  {controlBlocker:'aria-disabled'},{pointerBlocked:true},{status:'hidden'},
 ]){
  const out=await runReadOnlyInteractionReadiness(request(deps({visibility:v})));
  assert.equal(out.status,'blocked',JSON.stringify(v));
  assert.equal(out.V2,'blocked');
  assert.equal(out.interactionVerified,false);
 }
});
test('no direct listener, absent event evidence or unknown CSS conditions cannot produce readiness',async()=>{
 for(const scenario of [
  {listeners:{status:'none-observed',listenerCount:0}},
  {listeners:{status:'unknown',listenerCount:null}},
  {visibility:{pointerBlocked:null}},
  {visibility:{controlBlocker:'unknown'}},
  {listeners:{status:'registered',listenerCount:0}},
  {listeners:{status:'registered',listenerCount:999}},
  {visibility:{V2:'passed'}},
 ]){
  const out=await runReadOnlyInteractionReadiness(request(deps(scenario)));
  assert.equal(out.status,'needs-review',JSON.stringify(scenario));
  assert.equal(out.V2,'blocked');
 }
});
test('changing unique node fingerprint, target or reload invalidates combination of evidence',async()=>{
 const replaced=await runReadOnlyInteractionReadiness(request(deps({fingerprints:[digest,digest,'b'.repeat(64),'b'.repeat(64)]})));
 assert.equal(replaced.status,'needs-review');
 assert.equal(replaced.samples,2);
 await assert.rejects(runReadOnlyInteractionReadiness(request(deps({loaderIds:['original','original','new']}))),
  /document|loader|changed|identity/i);
 const mismatched=await runReadOnlyInteractionReadiness(request(deps({listeners:{url:'https://evil.test'}})));
 assert.equal(mismatched.status,'needs-review');
});
test('failed partial probe and telemetry errors are sanitized, never V2 or script success',async()=>{
 for(const stage of ['probe','visibility','listeners']){
  const out=await runReadOnlyInteractionReadiness(request(deps({throwOn:stage})));
  assert.equal(out.status,'needs-review');
  assert.ok(!JSON.stringify(out).includes('private-'));
  assert.ok(!JSON.stringify(out).includes('secret'));
  assert.equal(out.V2,'blocked');
 }
});
test('unapproved, invalid or dynamic selectors cannot open browser observation path',async()=>{
 let calls=0;
 const d=deps();d.confirm=async()=>{calls++;return identity;};
 for(const invalid of [
  {...request(d),approved:false},
  {...request(d),caseId:'INVALID/SECRET'},
  {...request(d),locator:{...locator,runtimeRequired:true}},
  {...request(d),locator:{...locator,expression:'a'.repeat(1025)}},
  {...request(d),target:{...target,webSocketDebuggerUrl:'ws://evil.test/devtools/page/fixture'}},
 ]){
  await assert.rejects(runReadOnlyInteractionReadiness(invalid as any),/approval|invalid|static|selector|CDP|loopback/i);
 }
 assert.equal(calls,0);
});

test('a positive readiness result must re-pin the same DOM node after CSS and listener observations',async()=>{
 const d=deps();
 const result=await runReadOnlyInteractionReadiness(request(d));
 assert.equal(result.status,'potentially-ready');
 assert.equal(d.calls.filter(method=>method==='probe').length,4,
  'Each sample must verify the exact node both before and after separate CDP evidence');
 assert.equal(d.calls.filter(method=>method==='listeners').length,2);
});
test('a replacement between DOM pin and control metadata cannot be combined into a positive result',async()=>{
 const d=deps({fingerprints:[digest,'b'.repeat(64)]});
 const result=await runReadOnlyInteractionReadiness(request(d));
 assert.equal(result.status,'needs-review');
 assert.equal(result.samples,1,
  'Change within the first sample must fail before waiting for a second sample');
 assert.equal(d.calls.filter(method=>method==='wait').length,0);
 assert.equal(d.calls.filter(method=>method==='probe').length,2);
});
test('a transient replacement in the second sample must invalidate otherwise stable first-sample evidence',async()=>{
 const d=deps({fingerprints:[digest,digest,digest,'b'.repeat(64)]});
 const result=await runReadOnlyInteractionReadiness(request(d));
 assert.equal(result.status,'needs-review');
 assert.equal(result.samples,2);
 assert.equal(d.calls.filter(method=>method==='probe').length,4);
 assert.equal(result.V2,'blocked');
 assert.equal(result.functionalVerified,false);
});

test('a stale disabled/hidden observation after DOM replacement must not claim the pinned node was blocked',async()=>{
 for(const visibility of [{status:'hidden'},{controlBlocker:'aria-disabled'},{pointerBlocked:true}]){
  const d=deps({fingerprints:[digest,'b'.repeat(64)],visibility});
  const result=await runReadOnlyInteractionReadiness(request(d));
  assert.equal(result.status,'needs-review',JSON.stringify(visibility));
  assert.equal(result.samples,1);
  assert.equal(d.calls.filter(method=>method==='probe').length,2);
  assert.equal(d.calls.filter(method=>method==='listeners').length,0);
  assert.equal(d.calls.filter(method=>method==='wait').length,0);
 }
});
test('a genuine pinned blocked control still reports the blocker without clicking or collecting listeners',async()=>{
 const d=deps({fingerprints:[digest,digest],visibility:{controlBlocker:'disabled-attribute'}});
 const result=await runReadOnlyInteractionReadiness(request(d));
 assert.equal(result.status,'blocked');
 assert.equal(result.samples,1);
 assert.equal(d.calls.filter(method=>method==='probe').length,2);
 assert.equal(d.calls.filter(method=>method==='listeners').length,0);
 assert.equal(result.V2,'blocked');
});
