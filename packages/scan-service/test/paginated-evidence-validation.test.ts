import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';

const targetId='page-verified';
const pageUrl='https://fixture.example.invalid/stable';
const sample=(index:number)=>({
 index,scriptId:'script-'+index,path:'script-'+index+'.user.js',
 status:'dom-present',checked:1,found:1,missing:0,needsReview:0,
});
const page=(rows:readonly any[],start=0,total=rows.length)=>({
 validationLevel:'dom-only' as const,pageTargetId:targetId,pageUrl,
 pageDocumentToken:'a'.repeat(64),
 startIndex:start,totalItems:rows.length,remainingItems:total-start-rows.length,
 items:rows,
});
const verification={
 V0:'passed',V1:'passed',V2:'blocked',V3:'not-configured',
 V4:'not-configured',highestVerified:'V1',
 functionalVerified:false,managerVerified:false,
};
test('FR-024 pagination fails closed on inconsistent per-script counts before progress publication',async()=>{
 const good=sample(0);
 const invalid=[
  {...good,checked:2},
  {...good,found:0,missing:1},
  {...good,found:2},
  {...good,found:1.5},
  {...good,found:-1},
  {...good,checked:51,found:51},
  {...good,status:'locator-missing',missing:0},
  {...good,status:'needs-review',needsReview:0},
  {...good,status:'skipped',checked:1,found:1},
  {...good,status:'made-up-status'},
 ];
 for(const row of invalid){
  let progress=0;
  await assert.rejects(collectPagedDomDiagnosis({
   total:1,targetId,requestPage:async()=>page([row]),
   isCancelled:()=>false,onProgress:()=>{progress++;},
  }),/evidence|pagination|status|count|invalid|verification/i,JSON.stringify(row));
  assert.equal(progress,0,'invalid script outcomes cannot reach renderer progress');
 }
});

test('FR-024 pagination rejects forged V1/V2/V3/V4 pass even with otherwise plausible counters',async()=>{
 const good=sample(0);
 for(const row of [
  {...good,status:'needs-review',found:0,needsReview:1,verification},
  {...good,verification:{...verification,V2:'passed'}},
  {...good,verification:{...verification,V3:'passed'}},
  {...good,verification:{...verification,V4:'passed'}},
  {...good,verification:{...verification,functionalVerified:true}},
  {...good,verification:{...verification,managerVerified:true}},
 ]){
  let published=false;
  await assert.rejects(collectPagedDomDiagnosis({
   total:1,targetId,requestPage:async()=>page([row]),
   isCancelled:()=>false,onProgress:()=>{published=true;},
  }),/verification|evidence|invalid|status|level/i,JSON.stringify(row));
  assert.equal(published,false);
 }
});

test('FR-024 pagination preserves a valid V1-only result without upgrading V2-V4',async()=>{
 const good={...sample(0),verification};
 const out=await collectPagedDomDiagnosis({
  total:1,targetId,requestPage:async()=>page([good]),
  isCancelled:()=>false,onProgress:()=>{},
 });
 assert.equal(out.items[0]?.verification?.V1,'passed');
 assert.equal(out.items[0]?.verification?.V2,'blocked');
 assert.equal(out.items[0]?.verification?.V3,'not-configured');
 assert.equal(out.items[0]?.verification?.V4,'not-configured');
 assert.equal(out.cancelled,false);
});

test('FR-024 a forged later page cannot be published over prior verified progress',async()=>{
 let progress=0;
 await assert.rejects(collectPagedDomDiagnosis({
  total:26,targetId,
  requestPage:async offset=>offset===0?
   page(Array.from({length:25},(_,i)=>sample(i)),0,26):
   page([{...sample(25),status:'dom-present',found:0,missing:1}],25,26),
  isCancelled:()=>false,
  onProgress:()=>{progress++;},
 }),/evidence|pagination|status|count|invalid/i);
 assert.equal(progress,1,'page one stays valid; invalid second page cannot enter progress');
});
