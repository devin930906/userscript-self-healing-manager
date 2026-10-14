import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as readiness from '../src/read-only-interaction-readiness.ts';

const target={
 type:'page',id:'tab1',url:'https://example.org/authorized',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/tab1',
} as const;
const locator={method:'querySelector',expression:'#action',runtimeRequired:false} as const;
const digest='a'.repeat(64);
const identity={targetId:target.id,confirmedUrl:target.url,frameId:'f1',loaderId:'l1',subframeCount:0};
const run=(readiness as unknown as {runReadOnlyVisibilityWait?: (request:any)=>Promise<any>}).runReadOnlyVisibilityWait;
function scenario(samples:Array<{fingerprint?:string;status?:string;url?:string}>,changeDuringSample=false){
 let round=0,probes=0,checks=0,visits=0,waits=0;
 const deps={
  confirm:async()=>{checks++;return identity;},
  probe:async()=>{
   probes++;
   const x=samples[round]??{};
   const fingerprint=changeDuringSample&&round===0&&probes===2?'b'.repeat(64):x.fingerprint;
   return {targetId:target.id,url:target.url,validationLevel:'dom-only',checks:[{
    method:locator.method,expression:locator.expression,
    status:fingerprint?'found':'missing',matchCount:fingerprint?1:0,
    ...(fingerprint?{nodeFingerprint:fingerprint}:{}),
   }]};
  },
  inspectVisibility:async()=>{
   visits++;
   const x=samples[round]??{};
   return {targetId:target.id,url:x.url??target.url,validationLevel:'css-box-read-only',
    status:x.status??'potentially-visible',matchCount:1,pointerBlocked:false,
    controlBlocker:'none-detected',interactionVerified:false,
    V2:'blocked',V3:'not-configured',V4:'not-configured'};
  },
  wait:async()=>{waits++;round++;},
 };
 return {deps,counts:()=>({round,probes,checks,visits,waits})};
}
const request=(deps:unknown,extra:Record<string,unknown>={})=>({
 approved:true,target,locator,caseId:'VISIBLE_1',maxSamples:4,deps,...extra,
});

test('FR-025 bounded real-page wait requires two consecutive pinned visible samples and stays V1',async()=>{
 assert.equal(typeof run,'function','missing bounded visible wait implementation');
 const s=scenario([{}, {fingerprint:digest}, {fingerprint:digest}, {fingerprint:digest}]);
 const result=await run!(request(s.deps));
 assert.equal(result.status,'potentially-visible-v1');
 assert.equal(result.samples,3);
 assert.equal(result.evidenceLevel,'V1-visible-read-only');
 assert.equal(result.V2,'blocked');
 assert.equal(result.V3,'not-configured');
 assert.equal(result.V4,'not-configured');
 assert.equal(result.interactionVerified,false);
 assert.equal(result.functionalVerified,false);
 assert.equal(result.managerVerified,false);
 assert.equal(s.counts().waits,2);
 assert.equal(s.counts().visits,2);
});

test('FR-025 hidden or absent target exhausts bounded wait without false proof or background polling',async()=>{
 assert.equal(typeof run,'function');
 for(const samples of [
  [{},{},{},{}],
  Array.from({length:4},()=>({fingerprint:digest,status:'hidden'})),
 ]){
  const s=scenario(samples);
  const result=await run!(request(s.deps));
  assert.equal(result.status,'needs-review');
  assert.equal(result.samples,4);
  assert.equal(result.V2,'blocked');
  assert.equal(s.counts().waits,3);
 }
});

test('FR-025 forged mismatched visibility and element replacement during observation fail closed',async()=>{
 assert.equal(typeof run,'function');
 const wrong=scenario([{fingerprint:digest,url:'https://private.invalid/page'}]);
 const outcome=await run!(request(wrong.deps));
 assert.equal(outcome.status,'needs-review');
 assert.equal(outcome.samples,1);
 assert.equal(wrong.counts().waits,0);
 const replaced=scenario([{fingerprint:digest}],true);
 assert.equal((await run!(request(replaced.deps))).status,'needs-review');
 assert.equal(replaced.counts().waits,0);
});

test('FR-025 waiting requires user approval, valid exact CDP socket and credential-free page before any read',async()=>{
 assert.equal(typeof run,'function');
 let inspected=0;
 const deps={confirm:async()=>{inspected++;return identity;},probe:async()=>{inspected++;throw Error('called');},
  inspectVisibility:async()=>{inspected++;throw Error('called');},wait:async()=>{inspected++;}};
 const invalid=[
  {approved:false},
  {maxSamples:0},{maxSamples:20},
  {locator:{...locator,runtimeRequired:true}},
  {target:{...target,url:'https://user:secret@example.org/authorized'}},
  {target:{...target,webSocketDebuggerUrl:'ws://public.example/devtools/page/tab1'}},
 ];
 for(const sample of invalid)
  await assert.rejects(run!(request(deps,sample)),/approval|samples|static|invalid|CDP|credential|loopback|socket/i);
 assert.equal(inspected,0);
});

test('FR-025 bounded visibility wait rejects malformed document, iframe and fingerprint metadata before DOM access',async()=>{
 assert.equal(typeof run,'function');
 for(const mutation of [
  {frameId:'f'.repeat(257)},
  {loaderId:'l'.repeat(257)},
  {subframeCount:-1},
  {subframeCount:99},
  {subframeCount:0,soleSameOriginSubframe:{frameId:'child',loaderId:'load'}},
  {subframeCount:1,soleSameOriginSubframe:{frameId:'f1',loaderId:'load'}},
  {subframeCount:1,soleSameOriginSubframe:{frameId:'child',loaderId:'load',urlFingerprint:'wrong'}},
 ]){
  const s=scenario([{fingerprint:digest},{fingerprint:digest}]);
  (s.deps as any).confirm=async()=>({...identity,...mutation});
  await assert.rejects(run!(request(s.deps)),
   /identity|frame|loader|subframe|unverified|invalid/i);
  assert.equal(s.counts().probes,0,'bad page identity must fail before DOM/CSS queries');
  assert.equal(s.counts().visits,0);
 }
});
