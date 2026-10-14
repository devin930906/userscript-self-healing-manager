import assert from 'node:assert/strict';
import {test} from 'node:test';

const target={id:'page-one',type:'page' as const,url:'https://example.org/approved',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/page-one'};
const readiness={caseId:'READINESS:example',status:'potentially-ready',
 reason:'Two stable read-only samples',samples:2,directClickListeners:1,
 evidenceLevel:'V1+read-only-control-metadata',V2:'blocked',V3:'not-configured',
 V4:'not-configured',interactionVerified:false,functionalVerified:false,
 managerVerified:false} as const;

async function load(){
 const module=await import('../src/product-action-review.ts').catch(()=>({} as Record<string,unknown>));
 assert.equal(typeof (module as any).reviewProductAction,'function',
  'FR-025 production action-risk review service must exist');
 return (module as any).reviewProductAction as (input:any)=>any;
}
test('FR-025 product risk review explicitly classifies only user-selected actions, never performs them',async()=>{
 const review=await load();
 for(const [action,risk] of [
  ['observe','READ_ONLY'],['focus','LOW_IMPACT'],['click','STATE_CHANGING'],
  ['type','STATE_CHANGING'],['submit','DESTRUCTIVE'],
  ['send','DESTRUCTIVE'],['delete','DESTRUCTIVE'],['payment','DESTRUCTIVE'],
 ]){
  const v=review({approved:true,action,target,readiness});
  assert.equal(v.action,action);
  assert.equal(v.risk,risk);
  assert.equal(v.executionAllowed,false);
  assert.equal(v.V2,'blocked');
  assert.equal(v.V3,'not-configured');
  assert.equal(v.V4,'not-configured');
  assert.equal(v.interactionVerified,false);
  assert.equal(v.functionalVerified,false);
  assert.equal(v.managerVerified,false);
  assert.equal(v.validationLevel,'read-only-product-action-review');
  assert.equal(Object.keys(v).includes('executionToken'),false);
 }
});

test('FR-025 review never promotes a misleadingly ready DOM/button into safe click or function verification',async()=>{
 const review=await load();
 for(const state of ['potentially-ready','blocked','needs-review']){
  const v=review({approved:true,action:'click',target,readiness:{...readiness,status:state}});
  assert.equal(v.executionAllowed,false);
  assert.equal(v.V2,'blocked');
  assert.match(v.reason,/review|risk|approval|cannot|not|disabled/i);
 }
});
test('FR-025 review requires explicit approval, real verified loopback CDP target and bounded readiness evidence',async()=>{
 const review=await load();
 for(const input of [
  {approved:false,action:'focus',target,readiness},
  {approved:true,action:'pay',target,readiness},
  {approved:true,action:'__proto__',target,readiness},
  {approved:true,action:'click',target:{...target,webSocketDebuggerUrl:'ws://evil.example/devtools/page/page-one'},readiness},
  {approved:true,action:'click',target:{...target,url:'https://example.org/#private',id:'other'},readiness},
  {approved:true,action:'click',target,readiness:{...readiness,V2:'passed'}},
  {approved:true,action:'click',target,readiness:{...readiness,interactionVerified:true}},
  {approved:true,action:'click',target,readiness:{...readiness,samples:42}},
 ]){
  assert.throws(()=>review(input),/approval|action|unsupported|CDP|target|evidence|readiness|invalid/i);
 }
});
test('FR-025 dangerous intents remain denied even if caller supplies forged approval flags',async()=>{
 const review=await load();
 const v=review({approved:true,action:'send',target,readiness,
  execute:true,allowDangerous:true,verifiedByUser:true,pretendV2:true});
 assert.equal(v.risk,'DESTRUCTIVE');
 assert.equal(v.executionAllowed,false);
 assert.equal(v.V2,'blocked');
 assert.ok(!('dispatch' in v));
});
