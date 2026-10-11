import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeSource} from '../../source-analyzer/src/index.ts';
import {diagnoseScriptsOnPage} from '../src/batch-dom.ts';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';
import type {ScanItemResult} from '../src/index.ts';

const target={
 type:'page',id:'qa034-test-tab',url:'https://fixture.example.invalid/stable',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/qa034-test-tab',
};
function syntheticItems(total:number):ScanItemResult[]{
 return Array.from({length:total},(_,i)=>{
  const scriptId='qa034-'+i;
  const source=[
   '// ==UserScript==',
   '// @name QA-034 fixture '+i,
   '// @match https://fixture.example.invalid/*',
   '// @grant none',
   '// ==/UserScript==',
   'document.querySelector("#node-'+i+'");',
  ].join('\n');
  const analysis=analyzeSource({scriptId,sourceBytes:new TextEncoder().encode(source)});
  assert.equal(analysis.selectorRecords.length,1);
  assert.equal(analysis.selectorRecords[0]?.runtimeRequired,false);
  return {
   path:'fixture-'+i+'.user.js',scriptId,status:'parsed' as const,
   selectorCount:1,runtimeRequiredCount:0,diagnostics:[],analysis,
  };
 });
}
test('QA-034 one failing CDP item in 30 retains the other 29 script outcomes across two authenticated pages',async()=>{
 const inputs=syntheticItems(30);
 const expectedItems=inputs.map(item=>({scriptId:item.scriptId,path:item.path}));
 const probed:string[]=[];
 const progress:number[]=[];
 const result=await collectPagedDomDiagnosis({
  total:30,targetId:target.id,expectedItems,
  isCancelled:()=>false,
  requestPage:async offset=>{
   const chunk=inputs.slice(offset,offset+25);
   const diagnosis=await diagnoseScriptsOnPage({items:chunk,target,consent:true,deps:{
    confirm:async()=>({
     targetId:target.id,confirmedUrl:target.url,frameId:'stable-frame',loaderId:'stable-loader',
     subframeCount:0,
    }),
    summarize:async()=>({targetId:target.id,url:target.url,authorShadowTreeNodes:0}),
    probe:async(_target,locators)=>{
     const locator=locators[0]?.expression??'';
     probed.push(locator);
     if(locator==='#node-13')
      throw new Error('CDP failed at private URL https://private.example.invalid/?session=DO_NOT_LEAK');
     return {targetId:target.id,url:target.url,validationLevel:'dom-only' as const,
      checks:locators.map(x=>({method:x.method,expression:x.expression,status:'found' as const,matchCount:1}))};
    },
   }});
   return {...diagnosis,startIndex:offset,remainingItems:30-offset-chunk.length,
    items:diagnosis.items.map(row=>({...row,index:row.index+offset}))};
  },
  onProgress:batch=>progress.push(batch.totalItems),
 });
 assert.deepEqual(progress,[25,30]);
 assert.equal(result.totalItems,30);
 assert.equal(result.remainingItems,0);
 assert.equal(result.cancelled,false);
 assert.equal(result.items.length,30);
 assert.deepEqual(result.items.map(row=>row.index),Array.from({length:30},(_,i)=>i));
 assert.deepEqual(probed,Array.from({length:30},(_,i)=>'#node-'+i));
 assert.equal(result.items.filter(row=>row.status==='error').length,1);
 assert.equal(result.items[13]?.status,'error');
 assert.equal(result.items[13]?.reason,'CDP locator probe failed');
 assert.equal(result.items[13]?.verification?.V1,'blocked');
 assert.equal(result.items.filter(row=>row.status==='dom-present').length,29);
 assert.equal(result.items.filter(row=>row.verification?.V1==='passed').length,29);
 assert.equal(result.items.every(row=>row.verification?.V2==='blocked'&&
  row.verification?.V3==='not-configured'&&row.verification?.V4==='not-configured'),true);
 assert.doesNotMatch(JSON.stringify(result),/DO_NOT_LEAK|private\.example|session=/);
});
