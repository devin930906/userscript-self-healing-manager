import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';

const targetId='fixture-page';
const url='https://fixture.example.invalid/list';
const baseRow={
 index:0,scriptId:'synthetic-0',path:'synthetic-0.user.js',
 status:'dom-present',checked:1,found:1,missing:0,needsReview:0,
};
const page=(item:unknown)=>({
 validationLevel:'dom-only' as const,pageTargetId:targetId,pageUrl:url,
 pageDocumentToken:'a'.repeat(64),startIndex:0,totalItems:1,
 remainingItems:0,items:[item],
});
const verify=(item:unknown,onProgress=()=>{})=>collectPagedDomDiagnosis({
 total:1,targetId,requestPage:async()=>page(item as Record<string,unknown>),
 isCancelled:()=>false,onProgress,
});

test('FR-024 a V1 DOM pass never carries an unrelated CDP or missing-selector fault reason',async()=>{
 for(const reason of [
  'CDP locator probe failed','CDP evidence identity or shape mismatch',
  'No valid static analysis','Selected page is not covered by @match/@include',
 ]){
  let published=0;
  await assert.rejects(verify({...baseRow,reason},()=>{published++;}),
   /invalid|reason|status|diagnostic|evidence/i);
  assert.equal(published,0,'contradictory V1 evidence must not reach progress');
 }
});

test('FR-018 a failed, skipped or out-of-scope row cannot borrow another status reason',async()=>{
 const rows=[
  {...baseRow,status:'error',checked:0,found:0,reason:'No selectors identified'},
  {...baseRow,status:'skipped',checked:0,found:0,reason:'CDP locator probe failed'},
  {...baseRow,status:'out-of-scope',checked:0,found:0,reason:'No selectors identified'},
  {...baseRow,status:'needs-review',checked:0,found:0,needsReview:1,
   reason:'CDP evidence identity or shape mismatch'},
 ];
 for(const row of rows){
  let published=0;
  await assert.rejects(verify(row,()=>{published++;}),/invalid|reason|status|diagnostic|evidence/i,
    JSON.stringify(row));
  assert.equal(published,0);
 }
});

test('FR-024 trusted producer reasons stay compatible with their matching status',async()=>{
 const accepted=[
  {...baseRow},
  {...baseRow,status:'error',checked:0,found:0,reason:'CDP locator probe failed'},
  {...baseRow,status:'error',checked:0,found:0,reason:'Selector count exceeds batch safety limit'},
  {...baseRow,status:'skipped',checked:0,found:0,reason:'No valid static analysis'},
  {...baseRow,status:'out-of-scope',checked:0,found:0,
   reason:'Selected page is not covered by @match/@include'},
  {...baseRow,status:'no-evidence',checked:0,found:0,reason:'No selectors identified'},
  {...baseRow,status:'needs-review',checked:0,found:0,needsReview:1,
   reason:'Only dynamic or non-document locators'},
  {...baseRow,status:'needs-review',checked:0,found:0,needsReview:1,
   reason:'iframe browsing context detected; top-document evidence cannot verify nested frames'},
  {...baseRow,status:'needs-review',checked:0,found:0,needsReview:1,
   reason:'iframe browsing context detected; top-document evidence cannot verify nested frames; Author Shadow DOM detected; top-document selector miss cannot inspect nested ShadowRoot'},
 ];
 for(const row of accepted){
  let published=0;
  const outcome=await verify(row,()=>{published++;});
  assert.equal(published,1,JSON.stringify(row));
  assert.equal(outcome.items[0]?.reason,row.reason);
  assert.notEqual(outcome.items[0]?.verification?.V3,'passed');
 }
});
