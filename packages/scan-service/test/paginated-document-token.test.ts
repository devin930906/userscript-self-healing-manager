import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';

const targetId='verified-page';
const url='https://fixture.example.test/same-url';
const token='a'.repeat(64);
const page=(startIndex:number,total:number,pageDocumentToken?:string)=>({
 validationLevel:'dom-only' as const,
 pageTargetId:targetId,pageUrl:url,
 ...(pageDocumentToken===undefined?{}:{pageDocumentToken}),
 startIndex,totalItems:Math.min(25,total-startIndex),
 remainingItems:total-startIndex-Math.min(25,total-startIndex),
 items:Array.from({length:Math.min(25,total-startIndex)},(_,i)=>({
  index:startIndex+i,scriptId:'script-'+(startIndex+i),path:'script-'+(startIndex+i)+'.user.js',
  status:'dom-present' as const,checked:1,found:1,missing:0,needsReview:0,
 })),
});

test('even a one-page V1 batch must not publish evidence without a main-document fingerprint',async()=>{
 let published=0;
 await assert.rejects(collectPagedDomDiagnosis({
  total:1,targetId,requestPage:async()=>page(0,1),
  isCancelled:()=>false,onProgress:()=>{published++;},
 }),/document|identity|token|fingerprint/i);
 assert.equal(published,0);
});

test('a valid paginated DOM batch requires the same non-optional document token on every page',async()=>{
 const offsets:number[]=[];
 const result=await collectPagedDomDiagnosis({
  total:26,targetId,requestPage:async offset=>{offsets.push(offset);return page(offset,26,token);},
  isCancelled:()=>false,onProgress:()=>{},
 });
 assert.deepEqual(offsets,[0,25]);
 assert.equal(result.items.length,26);
 assert.equal(result.pageDocumentToken,token);
});

test('a later page lacking the fingerprint cannot join an already authenticated batch',async()=>{
 let published=0;
 await assert.rejects(collectPagedDomDiagnosis({
  total:26,targetId,requestPage:async offset=>offset===0?page(offset,26,token):page(offset,26),
  isCancelled:()=>false,onProgress:()=>{published++;},
 }),/document|identity|token|fingerprint/i);
 assert.equal(published,1);
});
