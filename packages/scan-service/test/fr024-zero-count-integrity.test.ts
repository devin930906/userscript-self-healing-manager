import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';
import {diagnoseScriptsOnPage,type BatchDomItem} from '../src/batch-dom.ts';
import type {ScanItemResult} from '../src/index.ts';

const targetId='fr024-zero-counter';
const pageUrl='https://fixture.example.invalid/review';
const pageDocumentToken='c'.repeat(64);
const row=(index:number):BatchDomItem=>({
 index,scriptId:'synthetic-'+index,path:'synthetic-'+index+'.user.js',
 status:'dom-present',checked:1,found:1,missing:0,needsReview:0,
});
const page=(offset:number,total:number,items:readonly BatchDomItem[])=>({
 validationLevel:'dom-only' as const,
 pageTargetId:targetId,pageUrl,pageDocumentToken,
 startIndex:offset,totalItems:items.length,remainingItems:total-offset-items.length,
 items,
});

test('FR-024 preserves zero-CDP-observation review counts for dynamic or unknown-scope locators',async()=>{
 for(const needsReview of [1,2,50]){
  let published=0;
  const review={...row(0),status:'needs-review' as const,checked:0,
   found:0,missing:0,needsReview};
  const result=await collectPagedDomDiagnosis({
   total:1,targetId,requestPage:async()=>page(0,1,[review]),
   isCancelled:()=>false,onProgress:()=>{published++;},
  });
  assert.equal(result.items[0]?.status,'needs-review');
  assert.equal(result.items[0]?.checked,0);
  assert.equal(result.items[0]?.needsReview,needsReview);
  assert.equal(published,1);
 }
});

test('FR-024 refuses an unprobed review count above the per-script 50-selector budget',async()=>{
 for(const needsReview of [51,5000]){
  let published=0;
  const malformed={...row(0),status:'needs-review' as const,checked:0,
   found:0,missing:0,needsReview};
  await assert.rejects(collectPagedDomDiagnosis({
   total:1,targetId,requestPage:async()=>page(0,1,[malformed]),
   isCancelled:()=>false,onProgress:()=>{published++;},
  }),/invalid|evidence|counter|limit|budget/i);
  assert.equal(published,0,'over-budget uninspected locator counts must not reach the renderer');
 }
});

test('FR-024 rejects an over-budget second page without publishing its evidence',async()=>{
 let published=0;
 await assert.rejects(collectPagedDomDiagnosis({
  total:26,targetId,
  requestPage:async offset=>offset===0?
   page(0,26,Array.from({length:25},(_,i)=>row(i))):
   page(25,26,[{...row(25),status:'needs-review',checked:0,
    found:0,missing:0,needsReview:51}]),
  isCancelled:()=>false,onProgress:()=>{published++;},
 }),/invalid|evidence|counter|limit|budget/i);
 assert.equal(published,1,'previous valid page remains published; the invalid page does not');
});

test('FR-024 producer enforces 50 selector budget even when @match/@include scope is unknown',async()=>{
 const target={
  type:'page',id:'fr024-page',url:pageUrl,
  webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fr024-page',
 };
 let probes=0;
 const script={
  path:'many.user.js',scriptId:'many',status:'parsed',
  analysis:{
   metadata:{match:[],include:[],raw:{}},
   selectorRecords:Array.from({length:51},(_,i)=>({
    method:'querySelector',expression:'#node-'+i,runtimeRequired:false,
    receiver:'document',
   })),
  },
 } as unknown as ScanItemResult;
 const result=await diagnoseScriptsOnPage({
  items:[script],target,consent:true,deps:{
   confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'main',loaderId:'stable'}),
   probe:async()=>{probes++;throw new Error('CDP probe must never run for over-budget scope-unknown input');},
  },
 });
 assert.equal(probes,0);
 assert.equal(result.items[0]?.status,'error');
 assert.equal(result.items[0]?.checked,0);
 assert.equal(result.items[0]?.needsReview,0);
 assert.equal(result.items[0]?.reason,'Selector count exceeds batch safety limit');
});
