import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diagnoseScriptsOnPage} from '../src/batch-dom.ts';

const target={type:'page',id:'identity-page',url:'https://example.test/page',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/identity-page'};
const item={path:'one.user.js',scriptId:'one',status:'parsed',
 analysis:{metadata:{match:['https://example.test/*'],include:[],raw:{}},
 selectorRecords:[{method:'querySelector',expression:'#item',runtimeRequired:false,receiver:'document'}]}};

async function testIdentity(identity:Record<string,unknown>){
 let probed=0;
 const outcome=diagnoseScriptsOnPage({items:[item] as any,target,consent:true,deps:{
  confirm:async()=>({targetId:target.id,confirmedUrl:target.url,...identity}) as any,
  probe:async()=>{probed++;return {targetId:target.id,url:target.url,validationLevel:'dom-only' as const,
   checks:[{method:'querySelector',expression:'#item',status:'missing' as const,matchCount:0}]};},
  summarize:async()=>({targetId:target.id,url:target.url,authorShadowTreeNodes:0}),
 }});
 return {outcome,probed:()=>probed};
}

test('batch refuses any positive or negative V1 evidence without a pinned main Frame and Loader',async()=>{
 const invalid=[
  {},
  {frameId:'main'},
  {loaderId:'loader'},
  {frameId:'',loaderId:'loader'},
  {frameId:'main',loaderId:''},
  {frameId:'a'.repeat(257),loaderId:'loader'},
  {frameId:'main',loaderId:'b'.repeat(257)},
  {frameId:123,loaderId:'loader'},
 ];
 for(const identity of invalid){
  const result=await testIdentity(identity);
  await assert.rejects(result.outcome,/frame|loader|document|identity/i,JSON.stringify(identity));
  assert.equal(result.probed(),0,'must reject before CDP selector probe');
 }
});

test('invalid or unverified subframe counts cannot certify a top-document miss',async()=>{
 for(const subframeCount of [-1,1.5,65,NaN,'1',null]){
  const identity={frameId:'main',loaderId:'loader',subframeCount};
  const result=await testIdentity(identity);
  await assert.rejects(result.outcome,/frame|document|identity/i,JSON.stringify(identity));
  assert.equal(result.probed(),0);
 }
});

test('a child frame identity cannot be claimed without a single verified child',async()=>{
 for(const identity of [
  {frameId:'main',loaderId:'loader',soleSameOriginSubframe:{frameId:'child',loaderId:'child-load'}},
  {frameId:'main',loaderId:'loader',subframeCount:2,soleSameOriginSubframe:{frameId:'child',loaderId:'child-load'}},
  {frameId:'main',loaderId:'loader',subframeCount:1,soleSameOriginSubframe:{frameId:'main',loaderId:'child-load'}},
  {frameId:'main',loaderId:'loader',subframeCount:1,soleSameOriginSubframe:{frameId:'child',loaderId:''}},
 ]){
  const result=await testIdentity(identity);
  await assert.rejects(result.outcome,/frame|document|identity/i);
  assert.equal(result.probed(),0);
 }
});

test('confirmed page tokens preserve valid read-only results and always emit a document fingerprint',async()=>{
 const result=await testIdentity({frameId:'main',loaderId:'loader',subframeCount:0});
 const batch=await result.outcome;
 assert.equal(batch.items[0]?.status,'locator-missing');
 assert.match(batch.pageDocumentToken??'',/^[a-f0-9]{64}$/);
 assert.equal(result.probed(),1);
});
