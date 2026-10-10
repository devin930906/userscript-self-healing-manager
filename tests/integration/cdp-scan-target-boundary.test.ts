import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diagnoseScriptsOnPage} from '../../packages/scan-service/src/batch-dom.ts';
import {runReadOnlyDomContract} from '../../packages/test-runner/src/index.ts';

const page={type:'page',id:'fixture',url:'https://example.org/app',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fixture'};
const locator={method:'querySelector',expression:'#fixture',runtimeRequired:false} as const;
const invalidTargets=[
 {label:'non-loopback host',value:{...page,webSocketDebuggerUrl:'ws://other.invalid:9223/devtools/page/fixture'}},
 {label:'different port',value:{...page,webSocketDebuggerUrl:'ws://127.0.0.1:9224/devtools/page/fixture'}},
 {label:'different page ID',value:{...page,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/other'}},
 {label:'non-page type',value:{...page,type:'service_worker'}},
] as const;

for(const {label,value} of invalidTargets){
 test('CDP read-only scan blocks '+label+' before observation',async()=>{
  let called=0;
  const confirm=async()=>{called++;return {targetId:page.id,confirmedUrl:page.url,frameId:'main',loaderId:'loader'};};
  await assert.rejects(diagnoseScriptsOnPage({items:[],target:value,consent:true,
   deps:{confirm,probe:async()=>{called++;throw Error('unexpected');}},
  }),/CDP|page|port|identity|loopback|WebSocket/i);
  assert.equal(called,0);

  await assert.rejects(runReadOnlyDomContract({approved:true,target:value,
   caseId:'fixture:locator',locator,expectation:'exists',
   deps:{confirm,probe:async()=>{called++;throw Error('unexpected');},wait:async()=>{}},
  }),/CDP|page|port|identity|loopback|WebSocket/i);
  assert.equal(called,0);
 });
}

test('authorized loopback CDP remains a bounded read-only V1 observation',async()=>{
 let calls=0;
 const confirm=async()=>({targetId:page.id,confirmedUrl:page.url,frameId:'main',loaderId:'loader'});
 const batch=await diagnoseScriptsOnPage({items:[],target:page,consent:true,
  deps:{confirm,probe:async()=>{throw Error('no locators');}},
 });
 assert.equal(batch.totalItems,0);
 assert.equal(batch.validationLevel,'dom-only');
 const result=await runReadOnlyDomContract({approved:true,target:page,caseId:'fixture:locator',
  locator,expectation:'exists',deps:{confirm,wait:async()=>{},probe:async()=>{
   calls++;
   return {targetId:page.id,url:page.url,validationLevel:'dom-only' as const,checks:[
    {method:locator.method,expression:locator.expression,status:'found' as const,matchCount:1}]};
  }}});
 assert.equal(result.status,'passed');
 assert.equal(result.functionalVerified,false);
 assert.equal(result.V4,'not-configured');
 assert.equal(calls,2);
});

test('both CDP entrypoints require explicit approval before observing',async()=>{
 let calls=0;
 const confirm=async()=>{calls++;throw Error('not called');};
 await assert.rejects(diagnoseScriptsOnPage({items:[],target:page,consent:false,
  deps:{confirm,probe:async()=>{throw Error('no');}}}),/consent|approval/i);
 await assert.rejects(runReadOnlyDomContract({approved:false,target:page,
  caseId:'fixture:locator',locator,expectation:'exists',
  deps:{confirm,probe:async()=>{throw Error('no');},wait:async()=>{}},
 }),/consent|approval/i);
 assert.equal(calls,0);
});
