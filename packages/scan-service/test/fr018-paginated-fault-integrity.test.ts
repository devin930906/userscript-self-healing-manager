import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';

const targetId='fr018-page',pageUrl='https://fixture.example.test/stable';
const diagnostic={
 code:'CDP_PROBE_UNVERIFIED',origin:'unknown',category:'unknown',
 attribution:'unattributed',functionalVerified:false,
};
const item=(i:number)=>({
 index:i,scriptId:'script-'+i,path:'script-'+i+'.user.js',
 status:'error',checked:0,found:0,missing:0,needsReview:0,
 reason:'CDP locator probe failed',diagnostic:{...diagnostic},
});
const page=(rows:readonly any[],start:number,total:number)=>({
 validationLevel:'dom-only' as const,pageTargetId:targetId,pageUrl,
 pageDocumentToken:'f'.repeat(64),
 startIndex:start,totalItems:rows.length,remainingItems:total-start-rows.length,items:rows,
});

test('FR-018 paginated evidence rejects forged script/page origin and functional assertion claims',async()=>{
 const originals=[
  {...item(0),diagnostic:{...diagnostic,origin:'userscript'}},
  {...item(0),diagnostic:{...diagnostic,origin:'page'}},
  {...item(0),diagnostic:{...diagnostic,category:'functional-assertion'}},
  {...item(0),diagnostic:{...diagnostic,attribution:'protocol-boundary'}},
  {...item(0),diagnostic:{...diagnostic,code:'CDP_EVIDENCE_REJECTED'}},
  {...item(0),diagnostic:{...diagnostic,functionalVerified:true}},
  {...item(0),diagnostic:{...diagnostic,privateException:'secret'}},
  {...item(0),diagnostic:'CDP_PROBE_UNVERIFIED'},
 ];
 for(const row of originals){
  let published=0;
  await assert.rejects(collectPagedDomDiagnosis({
   total:1,targetId,requestPage:async()=>page([row],0,1),
   isCancelled:()=>false,onProgress:()=>{published++;},
  }),/fault|diagnostic|evidence|attribution|origin|invalid/i,JSON.stringify(row));
  assert.equal(published,0,'never publish a forged error origin or free-form diagnostic');
 }
});

test('FR-018 pagination never accepts diagnostics on success or contradictory selector attribution',async()=>{
 const success={...item(0),status:'dom-present',checked:1,found:1,reason:undefined};
 const missing={...item(0),status:'locator-missing',checked:1,found:0,missing:1,
  reason:undefined,diagnostic:{code:'DOM_SELECTOR_MISSING',origin:'userscript',category:'selector-assertion',
   attribution:'unattributed',functionalVerified:false}};
 for(const row of [success,missing]){
  await assert.rejects(collectPagedDomDiagnosis({
   total:1,targetId,requestPage:async()=>page([row],0,1),
   isCancelled:()=>false,onProgress:()=>{throw Error('invalid evidence escaped');},
  }),/fault|diagnostic|evidence|attribution|origin|invalid/i);
 }
});

test('FR-018 exact trusted diagnostic may pass across 25+1 pages without V3/V4 claims',async()=>{
 const pages:number[]=[];
 const out=await collectPagedDomDiagnosis({
  total:26,targetId,
  requestPage:async offset=>page(Array.from({length:Math.min(25,26-offset)},(_,i)=>item(offset+i)),offset,26),
  isCancelled:()=>false,onProgress:result=>pages.push(result.totalItems),
 });
 assert.deepEqual(pages,[25,26]);
 assert.equal(out.items.length,26);
 assert.ok(out.items.every(x=>x.diagnostic?.origin==='unknown'&&
  x.diagnostic?.category==='unknown'&&x.diagnostic?.functionalVerified===false));
});

test('FR-018 forged second-page fault evidence never replaces accepted first-page progress',async()=>{
 let progress=0;
 await assert.rejects(collectPagedDomDiagnosis({
  total:26,targetId,
  requestPage:async offset=>page(offset===0?
   Array.from({length:25},(_,i)=>item(i)):
   [{...item(25),diagnostic:{...diagnostic,origin:'userscript'}}],offset,26),
  isCancelled:()=>false,onProgress:()=>{progress++;},
 }),/fault|diagnostic|evidence|attribution|origin|invalid/i);
 assert.equal(progress,1);
});
