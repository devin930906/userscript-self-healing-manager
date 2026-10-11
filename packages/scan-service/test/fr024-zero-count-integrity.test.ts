import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';
import type {BatchDomItem} from '../src/batch-dom.ts';

const targetId='fr024-zero-counter';
const pageUrl='https://fixture.example.invalid/review';
const pageDocumentToken='c'.repeat(64);
const row=(index:number)=>({
 index,scriptId:'synthetic-'+index,path:'synthetic-'+index+'.user.js',
 status:'dom-present' as const,checked:1,found:1,missing:0,needsReview:0,
});
const page=(offset:number,total:number,items:readonly BatchDomItem[])=>({
 validationLevel:'dom-only' as const,
 pageTargetId:targetId,pageUrl,pageDocumentToken,
 startIndex:offset,totalItems:items.length,remainingItems:total-offset-items.length,
 items,
});

test('FR-024 rejects a zero-checked needs-review row before any progress publication',async()=>{
 for(const needsReview of [1,2,50]){
  let published=0;
  const malformed={...row(0),status:'needs-review' as const,checked:0,
   found:0,missing:0,needsReview};
  await assert.rejects(collectPagedDomDiagnosis({
   total:1,targetId,requestPage:async()=>page(0,1,[malformed]),
   isCancelled:()=>false,onProgress:()=>{published++;},
  }),/invalid|evidence|counter|status/i,
  'Zero observations cannot have positive needs-review counts');
  assert.equal(published,0,'no impossible zero-checked row may reach the renderer');
 }
});

test('FR-024 rejects impossible counter on page two without publishing second-page evidence',async()=>{
 let published=0;
 const output=collectPagedDomDiagnosis({
  total:26,targetId,
  requestPage:async offset=>offset===0?
   page(0,26,Array.from({length:25},(_,i)=>row(i))):
   page(25,26,[{...row(25),status:'needs-review',checked:0,
    found:0,missing:0,needsReview:1}]),
  isCancelled:()=>false,onProgress:()=>{published++;},
 });
 await assert.rejects(output,/invalid|evidence|counter|status/i);
 assert.equal(published,1,'previous authenticated page remains visible; forged second page must not publish');
});

test('FR-024 still accepts bounded needs-review count for one genuinely checked locator',async()=>{
 let published=0;
 const review={...row(0),status:'needs-review' as const,checked:1,
  found:0,missing:0,needsReview:1};
 const output=await collectPagedDomDiagnosis({
  total:1,targetId,requestPage:async()=>page(0,1,[review]),
  isCancelled:()=>false,onProgress:()=>{published++;},
 });
 assert.equal(output.totalItems,1);
 assert.equal(output.items[0]?.status,'needs-review');
 assert.equal(published,1);
});
