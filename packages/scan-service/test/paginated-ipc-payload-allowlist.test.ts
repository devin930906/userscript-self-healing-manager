import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPagedDomDiagnosis} from '../src/paginated-dom.ts';

const targetId='ipc-private-evidence';
const pageUrl='https://fixture.example.invalid/private';
const good={
 index:0,scriptId:'script-0',path:'script-0.user.js',
 status:'error',checked:0,found:0,missing:0,needsReview:0,
 reason:'CDP locator probe failed',
};
const projection={
 V0:'passed',V1:'blocked',V2:'blocked',V3:'not-configured',
 V4:'not-configured',highestVerified:'V0',
 functionalVerified:false,managerVerified:false,
};
function page(item:unknown){
 return {
  validationLevel:'dom-only' as const,pageTargetId:targetId,pageUrl,
  pageDocumentToken:'d'.repeat(64),
  startIndex:0,totalItems:1,remainingItems:0,items:[item],
 };
}
async function refusesPayload(payload:unknown){
 let published=0;
 await assert.rejects(collectPagedDomDiagnosis({
  total:1,targetId,
  requestPage:async()=>payload as ReturnType<typeof page>,
  isCancelled:()=>false,
  onProgress:()=>{published++;},
 }),/invalid|evidence|diagnostic|payload|private|reason/i);
 assert.equal(published,0,'forged data must never be published in progress');
}

test('RG-07 paginated IPC rejects arbitrary reason strings even when counters and diagnostic shapes look plausible',async()=>{
 for(const item of [
  {...good,reason:'SECRET_URL=https://private.example.invalid/?api_key=CANARY'},
  {...good,reason:'Error: /home/secret/.config/userscript.user.js'},
  {...good,status:'dom-present',checked:1,found:1,reason:'SECRET_STACK=CANARY'},
 ]){
  await refusesPayload(page(item));
 }
});

test('RG-07 paginated IPC refuses unapproved top-level, row and V-level properties before publication',async()=>{
 await refusesPayload({...page(good),privateStack:'CANARY'});
 await refusesPayload(page({...good,privateStack:'CANARY'}));
 await refusesPayload(page({...good,verification:{...projection,secretToken:'CANARY'}}));
 const hidden=Object.defineProperty({...good},'hiddenSecret',{value:'CANARY',enumerable:false});
 await refusesPayload(page(hidden));
});

test('RG-07 valid generated reason, canonical error classification and V-levels remain usable',async()=>{
 let publishes=0;
 const result=await collectPagedDomDiagnosis({
  total:1,targetId,
  requestPage:async()=>page({
   ...good,
   diagnostic:{
    code:'CDP_PROBE_UNVERIFIED',origin:'unknown',category:'unknown',
    attribution:'unattributed',functionalVerified:false,
   },
   verification:projection,
  }),
  isCancelled:()=>false,
  onProgress:()=>{publishes++;},
 });
 assert.equal(publishes,1);
 assert.equal(result.items[0]?.status,'error');
 assert.equal(result.items[0]?.reason,'CDP locator probe failed');
 assert.equal(result.items[0]?.verification?.V2,'blocked');
 assert.equal(result.items[0]?.diagnostic?.origin,'unknown');
});

test('RG-07 paginated IPC rejects malformed script identifiers and path values before any renderer publication',async()=>{
 const badRows=[
  {...good,path:null},
  {...good,path:{privatePath:'/tmp/PRIVATE_ACCOUNT_CANARY'}},
  {...good,path:['PRIVATE_ACCOUNT_CANARY']},
  {...good,path:''},
  {...good,path:'x'.repeat(4097)},
  {...good,scriptId:{privateToken:'CANARY'}},
  {...good,scriptId:1},
  {...good,scriptId:''},
  {...good,scriptId:'a'.repeat(129)},
 ];
 for(const item of badRows)await refusesPayload(page(item));
});

test('RG-07 paginated IPC still publishes bounded string identity or explicitly unknown scriptId',async()=>{
 for(const item of [
  {...good,path:'nested/synthetic.user.js',scriptId:'known_script-01'},
  {...good,path:'unknown.user.js',scriptId:null},
 ]){
  let published=0;
  const result=await collectPagedDomDiagnosis({
   total:1,targetId,
   requestPage:async()=>page(item),
   isCancelled:()=>false,
   onProgress:()=>{published++;},
  });
  assert.equal(published,1);
  assert.equal(result.items[0]?.path,item.path);
  assert.equal(result.items[0]?.scriptId,item.scriptId);
 }
});

