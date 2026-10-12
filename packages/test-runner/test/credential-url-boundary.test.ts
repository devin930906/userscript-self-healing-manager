import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runReadOnlyDomContract} from '../src/index.ts';
import {runReadOnlyInteractionReadiness} from '../src/read-only-interaction-readiness.ts';
import {observeReadOnlyPageExceptions} from '../../cdp-client/src/read-only-exceptions.ts';

const credentialUrls=[
 'https://fake-user:FAKE_PASSWORD@fixture.example.invalid/editor',
 'https://fake-user@fixture.example.invalid/editor',
] as const;
const target=(url:string)=>({
 type:'page',id:'credential-fenced',url,
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/credential-fenced',
});
const locator={method:'querySelector',expression:'#save',runtimeRequired:false};
const rejected=()=>{throw new Error('Unsafe target reached the read-only CDP adapter');};

test('RG-07 named read-only DOM test rejects credential URLs before page confirmation or probes',async()=>{
 for(const url of credentialUrls){
  let confirmed=0,probed=0;
  await assert.rejects(runReadOnlyDomContract({
   approved:true,target:target(url),caseId:'QA-047-DOM',locator,expectation:'exists',
   deps:{
    confirm:async()=>{confirmed++;return rejected();},
    probe:async()=>{probed++;return rejected();},
    wait:async()=>{rejected();},
   },
  }),/credential|userinfo|invalid.*URL/i);
  assert.equal(confirmed,0,'do not inspect a credential-bearing target');
  assert.equal(probed,0);
 }
});

test('RG-07 read-only interaction readiness rejects credential URLs before sensitive CDP reads',async()=>{
 for(const url of credentialUrls){
  let confirmed=0,probed=0;
  await assert.rejects(runReadOnlyInteractionReadiness({
   approved:true,target:target(url),caseId:'QA-047-READINESS',locator,
   deps:{
    confirm:async()=>{confirmed++;return rejected();},
    probe:async()=>{probed++;return rejected();},
    inspectVisibility:async()=>rejected(),
    inspectListeners:async()=>rejected(),
    wait:async()=>rejected(),
   },
  }),/credential|userinfo|invalid.*URL/i);
  assert.equal(confirmed,0);
  assert.equal(probed,0);
 }
});

test('RG-07 passive exception observer rejects credential URLs before opening runtime or confirmation',async()=>{
 for(const url of credentialUrls){
  let confirmed=0,sockets=0;
  await assert.rejects(observeReadOnlyPageExceptions(target(url),{
   approved:true,durationMs:100,
   confirm:async()=>{confirmed++;return rejected();},
   socketFactory:()=>{sockets++;return rejected();},
  }),/credential|userinfo|invalid.*URL/i);
  assert.equal(confirmed,0);
  assert.equal(sockets,0);
 }
});
