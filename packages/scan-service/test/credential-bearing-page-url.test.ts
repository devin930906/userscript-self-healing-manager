import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diagnoseScriptsOnPage} from '../src/batch-dom.ts';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';

const targetId='auth-credential-page';
const userinfoUrl='https://synthetic-user:SECRET_CANARY@fixture.example.invalid/editor';
const normalUrl='https://fixture.example.invalid/editor?view=review';
const row={index:0,scriptId:'script',path:'script.user.js',
 status:'no-evidence',checked:0,found:0,missing:0,needsReview:0};
const response=(pageUrl:string)=>({
 validationLevel:'dom-only' as const,pageTargetId:targetId,pageUrl,
 pageDocumentToken:'a'.repeat(64),startIndex:0,totalItems:1,remainingItems:0,
 items:[row],
});

test('RG-07 paginated IPC blocks HTTP basic-auth userinfo URLs before renderer progress',async()=>{
 for(const url of [userinfoUrl,'https://synthetic-user@fixture.example.invalid/editor']){
  let published=0;
  await assert.rejects(collectPagedDomDiagnosis({
   total:1,targetId,requestPage:async()=>response(url),
   isCancelled:()=>false,onProgress:()=>{published++;},
  }),/credential|userinfo|unsafe|invalid|page URL/i);
  assert.equal(published,0,'secret-bearing URL must not reach renderer progress');
 }
});

test('RG-07 producer rejects credential-bearing page target before any CDP identity or probe request',async()=>{
 for(const url of [userinfoUrl,'https://synthetic-user@fixture.example.invalid/editor']){
  let identities=0,probes=0;
  await assert.rejects(diagnoseScriptsOnPage({
   items:[],consent:true,
   target:{type:'page',id:targetId,url,
    webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/'+targetId},
   deps:{
    confirm:async()=>{identities++;return {targetId,confirmedUrl:url,frameId:'f',loaderId:'l'};},
    probe:async()=>{probes++;throw Error('must not probe credential-bearing page');},
   },
  }),/credential|userinfo|unsafe|invalid|page URL/i);
  assert.equal(identities,0);
  assert.equal(probes,0);
 }
});

test('RG-07 normal HTTP(S) page URLs including harmless query parameters retain page identity',async()=>{
 let progress=0;
 const result=await collectPagedDomDiagnosis({
  total:1,targetId,requestPage:async()=>response(normalUrl),
  isCancelled:()=>false,onProgress:()=>{progress++;},
 });
 assert.equal(result.pageUrl,normalUrl);
 assert.equal(result.items[0]?.status,'no-evidence');
 assert.equal(progress,1);
});
