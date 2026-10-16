import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runReadOnlyInteractionReadiness,runReadOnlyVisibilityWait} from '../src/read-only-interaction-readiness.ts';

const target={type:'page',id:'ready-own-proof',url:'https://fixture.example.test/consented',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/ready-own-proof'};
const locator={method:'querySelector',expression:'#button',runtimeRequired:false};
const identity={targetId:target.id,confirmedUrl:target.url,frameId:'main',loaderId:'stable'};
const node=()=>({method:locator.method,expression:locator.expression,
 status:'found',matchCount:1,nodeFingerprint:'b'.repeat(64)});
const probe=()=>({targetId:target.id,url:target.url,validationLevel:'dom-only',checks:[node()]});
const visibility=()=>({targetId:target.id,url:target.url,validationLevel:'css-box-read-only',
 status:'potentially-visible',matchCount:1,pointerBlocked:false,controlBlocker:'none-detected',
 V2:'blocked',V3:'not-configured',V4:'not-configured',interactionVerified:false});
const listeners=()=>({targetId:target.id,url:target.url,
 validationLevel:'direct-event-listener-read-only',status:'registered',listenerCount:1,
 eventType:'click',V2:'blocked',V3:'not-configured',V4:'not-configured',interactionVerified:false});
function execute(responses:{
 probe?:unknown;visibility?:unknown;listeners?:unknown;
}={}){
 const calls={probe:0,visibility:0,listeners:0};
 const deps={
  confirm:async()=>identity,
  wait:async()=>{},
  probe:async()=>{calls.probe++;return (responses.probe??probe()) as any;},
  inspectVisibility:async()=>{calls.visibility++;return (responses.visibility??visibility()) as any;},
  inspectListeners:async()=>{calls.listeners++;return (responses.listeners??listeners()) as any;},
 };
 const result=runReadOnlyInteractionReadiness({
  approved:true,target,locator,caseId:'FR025-OWN-EVIDENCE',deps,
 });
 return {calls,result};
}

test('FR-025 does not mark readiness from inherited CDP node packet identity',async()=>{
 const forged=Object.create(probe());
 const x=execute({probe:forged});
 const v=await x.result;
 assert.equal(v.status,'needs-review');
 assert.equal(v.samples,1);
 assert.equal(x.calls.visibility,0);
 assert.equal(v.V2,'blocked');
});

test('FR-025 does not certify DOM node continuity from inherited HMAC fingerprint',async()=>{
 const forged=Object.create({nodeFingerprint:'b'.repeat(64)});
 Object.assign(forged,{method:locator.method,expression:locator.expression,status:'found',matchCount:1});
 const x=execute({probe:{...probe(),checks:[forged]}});
 const v=await x.result;
 assert.equal(v.status,'needs-review');
 assert.equal(x.calls.visibility,0);
});

test('FR-025 node fingerprint accessors must never run in read-only readiness',async()=>{
 let invoked=0;
 const forged=node() as Record<string,unknown>;
 Object.defineProperty(forged,'nodeFingerprint',{get(){invoked++;throw Error('PRIVATE_READY_FINGERPRINT');}});
 const x=execute({probe:{...probe(),checks:[forged]}});
 const v=await x.result;
 assert.equal(invoked,0);
 assert.equal(v.status,'needs-review');
 assert.doesNotMatch(JSON.stringify(v),/PRIVATE_READY_FINGERPRINT/);
});

test('FR-025 inherited CSS visibility receipts cannot create potentially-ready result',async()=>{
 const x=execute({visibility:Object.create(visibility())});
 const v=await x.result;
 assert.equal(v.status,'needs-review');
 assert.equal(x.calls.listeners,0);
 assert.equal(v.directClickListeners,null);
});

test('FR-025 CSS visibility accessors must never execute inside readiness',async()=>{
 let invoked=0;
 const forged=visibility() as Record<string,unknown>;
 Object.defineProperty(forged,'status',{get(){invoked++;throw Error('PRIVATE_READY_CSS');}});
 const x=execute({visibility:forged});
 const v=await x.result;
 assert.equal(invoked,0);
 assert.equal(v.status,'needs-review');
 assert.doesNotMatch(JSON.stringify(v),/PRIVATE_READY_CSS/);
});

test('FR-025 inherited click listener receipts cannot create potentially-ready result',async()=>{
 const x=execute({listeners:Object.create(listeners())});
 const v=await x.result;
 assert.equal(v.status,'needs-review');
 assert.equal(v.directClickListeners,null);
 assert.equal(v.V3,'not-configured');
});

test('FR-025 click listener accessors cannot execute in read-only readiness',async()=>{
 let invoked=0;
 const forged=listeners() as Record<string,unknown>;
 Object.defineProperty(forged,'listenerCount',{get(){invoked++;throw Error('PRIVATE_READY_LISTENER');}});
 const x=execute({listeners:forged});
 const v=await x.result;
 assert.equal(invoked,0);
 assert.equal(v.status,'needs-review');
 assert.doesNotMatch(JSON.stringify(v),/PRIVATE_READY_LISTENER/);
});


// Visibility wait shares the untrusted CDP adapter boundary with interaction
// readiness. Tests intentionally use hostile in-memory receipts, never page JS.
function executeVisibilityWait(receipt:unknown){
 return runReadOnlyVisibilityWait({
  approved:true,target,locator,caseId:'FR025-VISIBLE-OWN-DATA',
  maxSamples:2,
  deps:{
   confirm:async()=>identity,
   probe:async()=>receipt as any,
   inspectVisibility:async()=>visibility() as any,
   wait:async()=>{},
  },
 });
}

test('FR-025 visibility wait does not invoke accessor-backed top-level probe fields',async()=>{
 let getterCalls=0;
 const hostile=probe() as Record<string,unknown>;
 Object.defineProperty(hostile,'validationLevel',{get(){
  getterCalls++;throw new Error('PRIVATE_VISIBLE_TOPLEVEL');
 }});
 const result=await executeVisibilityWait(hostile);
 assert.equal(getterCalls,0);
 assert.equal(result.status,'needs-review');
 assert.equal(result.V2,'blocked');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_VISIBLE_TOPLEVEL/);
});

test('FR-025 visibility wait does not invoke accessor-backed nested check identity',async()=>{
 let getterCalls=0;
 const hostile=node() as Record<string,unknown>;
 Object.defineProperty(hostile,'method',{get(){
  getterCalls++;throw new Error('PRIVATE_VISIBLE_METHOD');
 }});
 const result=await executeVisibilityWait({...probe(),checks:[hostile]});
 assert.equal(getterCalls,0);
 assert.equal(result.status,'needs-review');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_VISIBLE_METHOD/);
});

test('FR-025 visibility wait does not invoke accessor-backed missing result fields',async()=>{
 let getterCalls=0;
 const hostile=node() as Record<string,unknown>;
 Object.defineProperty(hostile,'status',{get(){
  getterCalls++;throw new Error('PRIVATE_VISIBLE_STATUS');
 }});
 const result=await executeVisibilityWait({...probe(),checks:[hostile]});
 assert.equal(getterCalls,0);
 assert.equal(result.status,'needs-review');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_VISIBLE_STATUS/);
});


// A revoked Proxy throws from Array.isArray itself. Untrusted CDP adapter
// receipts must remain inconclusive, never crash the bounded V1 observation.
function revoked<T extends object>(value:T):T{
 const revocable=Proxy.revocable(value,{});
 revocable.revoke();
 return revocable.proxy;
}

test('FR-025 revoked probe packets and check arrays are inconclusive without exception',async()=>{
 for(const forged of [
  revoked(probe()),
  {...probe(),checks:revoked([node()])},
  {...probe(),checks:[revoked(node())]},
 ]){
  const x=execute({probe:forged});
  const result=await x.result;
  assert.equal(result.status,'needs-review');
  assert.equal(result.samples,1);
  assert.equal(result.interactionVerified,false);
  assert.equal(x.calls.visibility,0);
 }
});

test('FR-025 revoked CSS and listener receipts never authorize readiness',async()=>{
 for(const source of [
  {visibility:revoked(visibility())},
  {listeners:revoked(listeners())},
 ]){
  const x=execute(source);
  const result=await x.result;
  assert.equal(result.status,'needs-review');
  assert.equal(result.directClickListeners,null);
  assert.equal(result.V2,'blocked');
  assert.equal(result.managerVerified,false);
 }
});

test('FR-025 visibility wait treats revoked probe and nested checks as needs-review',async()=>{
 for(const forged of [
  revoked(probe()),
  {...probe(),checks:revoked([node()])},
  {...probe(),checks:[revoked(node())]},
 ]){
  const result=await executeVisibilityWait(forged);
  assert.equal(result.status,'needs-review');
  assert.equal(result.samples,1);
  assert.equal(result.V2,'blocked');
  assert.equal(result.managerVerified,false);
 }
});
