import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';
import type {BatchDomItem} from '../src/batch-dom.ts';

const targetId='page-verified';
const pageUrl='https://example.org/stable';
const sample=(index:number):BatchDomItem=>({
 index,scriptId:'script-'+index,path:'script-'+index+'.user.js',
 status:'dom-present',checked:1,found:1,missing:0,needsReview:0,
});
const page=(offset:number,total=51,url=pageUrl)=>({
 validationLevel:'dom-only' as const,pageTargetId:targetId,pageUrl:url,
 startIndex:offset,totalItems:Math.min(25,total-offset),
 items:Array.from({length:Math.min(25,total-offset)},(_,i)=>sample(offset+i)),
 remainingItems:total-offset-Math.min(25,total-offset),
});
test('batch page collector handles all 51 scripts with identity-stable, contiguous pages',async()=>{
 const called:number[]=[];const progress:number[]=[];
 const done=await collectPagedDomDiagnosis({
  total:51,targetId,requestPage:async offset=>{called.push(offset);return page(offset);},
  isCancelled:()=>false,onProgress:evidence=>progress.push(evidence.items.length),
 });
 assert.deepEqual(called,[0,25,50]);
 assert.deepEqual(progress,[25,50,51]);
 assert.equal(done.cancelled,false);
 assert.equal(done.remainingItems,0);
 assert.deepEqual(done.items.map(item=>item.index),Array.from({length:51},(_,i)=>i));
 assert.equal(done.pageUrl,pageUrl);
});
test('batch collector refuses to concatenate evidence from a different URL even with the same target id',async()=>{
 const called:number[]=[];
 await assert.rejects(collectPagedDomDiagnosis({
  total:51,targetId,requestPage:async offset=>{called.push(offset);return page(offset,51,offset? 'https://example.org/navigated':pageUrl);},
  isCancelled:()=>false,onProgress:()=>{},
 }),/navigation|identity|URL/i);
 assert.deepEqual(called,[0,25],'must not make a third request after page identity changed');
});
test('batch collector stops before next request on cancellation and retains already completed evidence',async()=>{
 let cancel=false;const called:number[]=[];
 const done=await collectPagedDomDiagnosis({
  total:51,targetId,requestPage:async offset=>{called.push(offset);return page(offset);},
  isCancelled:()=>cancel,onProgress:()=>{cancel=true;},
 });
 assert.deepEqual(called,[0]);assert.equal(done.cancelled,true);
 assert.equal(done.remainingItems,26);assert.equal(done.items.length,25);
});
test('malformed or partial pagination is rejected before reporting results',async()=>{
 for(const bad of [
  {...page(0),startIndex:25},
  {...page(0),items:page(0).items.slice(1)},
  {...page(0),remainingItems:99},
  {...page(0),items:page(0).items.map((item,i)=>({...item,index:i+1}))},
  {...page(0),pageTargetId:'another-page'},
 ]){
  let notices=0;
  await assert.rejects(collectPagedDomDiagnosis({
   total:51,targetId,requestPage:async()=>bad,
   isCancelled:()=>false,onProgress:()=>{notices++;},
  }),/identity|page|pagination|partial|index|count/i);
  assert.equal(notices,0);
 }
});
