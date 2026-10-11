import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';
import {BatchPauseGate} from '../src/pause-gate.ts';
import type {BatchDomItem} from '../src/batch-dom.ts';

const targetId='page-verified';
const pageUrl='https://example.org/stable';
const sample=(index:number):BatchDomItem=>({
 index,scriptId:'script-'+index,path:'script-'+index+'.user.js',
 status:'dom-present',checked:1,found:1,missing:0,needsReview:0,
});
const page=(offset:number,total=51,url=pageUrl)=>({
 validationLevel:'dom-only' as const,pageTargetId:targetId,pageUrl:url,
 pageDocumentToken:'a'.repeat(64),
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

test('paged DOM collection rejects a changed script identity even if URL and row indexes match',async()=>{
 const expected=Array.from({length:51},(_,i)=>({scriptId:'script-'+i,path:'script-'+i+'.user.js'}));
 let notifications=0;
 await assert.rejects(collectPagedDomDiagnosis({
  total:51,targetId,expectedItems:expected,
  requestPage:async offset=>offset===25?
   {...page(offset),items:page(offset).items.map((item,i)=>i===0?{...item,scriptId:'replaced-script',path:'replaced.user.js'}:item)}:
   page(offset),
  isCancelled:()=>false,onProgress:()=>{notifications++;},
 }),/script.*identity|script.*changed|stale.*scan/i);
 assert.equal(notifications,1,'do not publish second page with stale script evidence');
});
test('paged DOM collection rejects identity substitution even within its first page',async()=>{
 const expected=Array.from({length:25},(_,i)=>({scriptId:'script-'+i,path:'script-'+i+'.user.js'}));
 await assert.rejects(collectPagedDomDiagnosis({
  total:25,targetId,expectedItems:expected,
  requestPage:async()=>({...page(0,25),items:page(0,25).items.map((item,i)=>i===4?{...item,path:'other.user.js'}:item)}),
  isCancelled:()=>false,onProgress:()=>{throw new Error('must not publish substituted evidence');},
 }),/script.*identity|script.*changed|stale.*scan/i);
});

test('rejects same-URL Chrome reload between consecutive script batches using document fingerprint',async()=>{
 const requested:number[]=[];let published=0;
 await assert.rejects(collectPagedDomDiagnosis({
  total:51,targetId,
  requestPage:async offset=>{
   requested.push(offset);
   return {...page(offset),pageDocumentToken:offset===0?'a'.repeat(64):'b'.repeat(64)};
  },
  isCancelled:()=>false,onProgress:()=>{published++;},
 }),/document|reload|identity|navigation/i);
 assert.deepEqual(requested,[0,25]);
 assert.equal(published,1,'stale second batch must never reach the UI');
});

test('pausing after a confirmed page prevents dispatch of the next CDP batch until resumed',async()=>{
 const gate=new BatchPauseGate();
 const requested:number[]=[];
 let firstComplete!:()=>void;
 const first=new Promise<void>(resolve=>{firstComplete=resolve;});
 const work=collectPagedDomDiagnosis({
  total:51,targetId,requestPage:async offset=>{requested.push(offset);return page(offset);},
  isCancelled:()=>gate.isCancelled,pauseGate:gate,
  onProgress:outcome=>{if(outcome.totalItems===25){gate.pause();firstComplete();}},
 });
 await first;
 await Promise.resolve();
 assert.deepEqual(requested,[0],'the second request must not start while paused');
 gate.resume();
 const outcome=await work;
 assert.deepEqual(requested,[0,25,50]);
 assert.equal(outcome.totalItems,51);
 assert.equal(outcome.cancelled,false);
});

test('one transient read-only CDP timeout retries the same page once with bounded attempts',async()=>{
 const requests:number[]=[];
 const output=await collectPagedDomDiagnosis({
  total:26,targetId,retryTransportFailures:1,
  requestPage:async offset=>{
   requests.push(offset);
   if(offset===0&&requests.length===1)throw new Error('CDP page identity timeout');
   return page(offset,26);
  },
  isCancelled:()=>false,onProgress:()=>{},
 });
 assert.deepEqual(requests,[0,0,25]);
 assert.equal(output.totalItems,26);
 assert.equal(output.cancelled,false);
});
test('permanent read errors do not retry forever and do not publish partial page results',async()=>{
 const attempts:number[]=[];let published=0;
 await assert.rejects(collectPagedDomDiagnosis({
  total:25,targetId,retryTransportFailures:1,
  requestPage:async offset=>{attempts.push(offset);throw new Error('CDP locator probe timeout');},
  isCancelled:()=>false,onProgress:()=>{published++;},
 }),/timeout/i);
 assert.deepEqual(attempts,[0,0]);
 assert.equal(published,0);
});
test('identity mismatch and untrusted failures never retry despite requested transport retry budget',async()=>{
 for(const reason of ['CDP page identity changed during inspection','Invalid CDP snapshot payload limit exceeded','Another error']){
  const attempts:number[]=[];
  await assert.rejects(collectPagedDomDiagnosis({
   total:25,targetId,retryTransportFailures:1,
   requestPage:async offset=>{attempts.push(offset);throw new Error(reason);},
   isCancelled:()=>false,onProgress:()=>{},
  }),()=>true);
  assert.deepEqual(attempts,[0],reason);
 }
});
test('cancellation while waiting to retry prevents the next CDP read',async()=>{
 const gate=new BatchPauseGate();
 let attempts=0;
 const outcome=await collectPagedDomDiagnosis({
  total:25,targetId,retryTransportFailures:1,pauseGate:gate,
  requestPage:async offset=>{attempts++;gate.cancel();throw new Error('CDP page identity timeout');},
  isCancelled:()=>gate.isCancelled,onProgress:()=>{},
 });
 assert.equal(attempts,1);
 assert.equal(outcome.cancelled,true);
 assert.equal(outcome.totalItems,0);
});

test('Electron IPC wraps a transient read-only CDP timeout without losing the one-retry allowance',async()=>{
 const requests:number[]=[];
 const batch=await collectPagedDomDiagnosis({
  total:25,targetId,retryTransportFailures:1,
  requestPage:async offset=>{
   requests.push(offset);
   if(requests.length===1)
    throw new Error("Error invoking remote method 'usshm:batch-diagnose': Error: CDP page identity timeout");
   return page(offset,25);
  },
  isCancelled:()=>false,onProgress:()=>{},
 });
 assert.deepEqual(requests,[0,0]);
 assert.equal(batch.totalItems,25);
});
test('Electron error wrapping never makes arbitrary handlers or identity changes retryable',async()=>{
 for(const msg of [
  "Error invoking remote method 'usshm:other': Error: CDP page identity timeout",
  "Error invoking remote method 'usshm:batch-diagnose': Error: CDP page identity changed during inspection",
  "Error invoking remote method 'usshm:batch-diagnose': Error: CDP page identity timeout; site refused",
 ]){
  let count=0;
  await assert.rejects(collectPagedDomDiagnosis({
   total:25,targetId,retryTransportFailures:1,
   requestPage:async()=>{count++;throw new Error(msg);},
   isCancelled:()=>false,onProgress:()=>{},
  }),()=>true);
  assert.equal(count,1,msg);
 }
});

test('a cancelled pause gate cannot return an incomplete read-only batch as completed when the separate callback is stale',async()=>{
 for(const whilePaused of [false,true]){
  const gate=new BatchPauseGate();
  const requested:number[]=[];
  const progress:number[]=[];
  let waiting!:()=>void;
  const checkpoint=new Promise<void>(resolve=>{waiting=resolve;});
  const work=collectPagedDomDiagnosis({
   total:51,targetId,pauseGate:gate,
   isCancelled:()=>false,
   requestPage:async offset=>{requested.push(offset);return page(offset);},
   onProgress:state=>{
    progress.push(state.totalItems);
    if(state.totalItems===25){
     if(whilePaused){gate.pause();waiting();}
     else gate.cancel();
    }
   },
  });
  if(whilePaused){await checkpoint;gate.cancel();}
  const outcome=await work;
  assert.deepEqual(requested,[0]);
  assert.deepEqual(progress,[25]);
  assert.equal(outcome.totalItems,25);
  assert.equal(outcome.remainingItems,26);
  assert.equal(outcome.cancelled,true,
   'cooperative gate refusal is cancellation, not a completed 25-of-51 diagnosis');
 }
});

test('a final-page progress callback cancelling the gate must never report successful completion',async()=>{
 const gate=new BatchPauseGate();
 const outcome=await collectPagedDomDiagnosis({
  total:25,targetId,pauseGate:gate,isCancelled:()=>false,
  requestPage:async offset=>page(offset,25),
  onProgress:()=>gate.cancel(),
 });
 assert.equal(outcome.items.length,25);
 assert.equal(outcome.cancelled,true,'final callback cancelled before report completion');
});
