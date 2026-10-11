import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runReadOnlyDomContract} from '../src/index.ts';
import {runReadOnlyInteractionReadiness} from '../src/read-only-interaction-readiness.ts';

const target={
 type:'page',id:'qa024-boundary',url:'https://fixture.example.test/authorized',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/qa024-boundary',
};
const identity={targetId:target.id,confirmedUrl:target.url,frameId:'main',loaderId:'same'};
const unsupported=[
 {method:'getElementById',expression:'\\0private-id',runtimeRequired:false},
 {method:'getElementsByName',expression:'private\\nquery',runtimeRequired:false},
 {method:'getElementsByClassName',expression:'button\\0private',runtimeRequired:false},
].map(locator=>({...locator,expression:locator.expression.replace('\\0','\0').replace('\\n','\n')}));
for(const locator of unsupported){
 test('FR-024 DOM assertion rejects selector unsupported by actual CDP CSS adapter: '+locator.method,async()=>{
  let calls=0;
  const result=runReadOnlyDomContract({
   approved:true,target,caseId:'QA024:CONTRACT',locator,expectation:'exists',
   deps:{
    confirm:async()=>{calls++;return identity;},
    wait:async()=>{calls++;},
    probe:async()=>{calls++;return {
     targetId:target.id,url:target.url,validationLevel:'dom-only' as const,
     checks:[{method:locator.method,expression:locator.expression,status:'found' as const,matchCount:1}],
    };},
   },
  });
  await assert.rejects(result,/static|unsupported|selector|CSS|CDP/i);
  assert.equal(calls,0,'impossible locator must be rejected before opening any CDP adapter');
 });
 test('FR-024 read-only interaction readiness rejects same unsupported locator: '+locator.method,async()=>{
  let calls=0;
  const result=runReadOnlyInteractionReadiness({
   approved:true,target,caseId:'QA024:READINESS',locator,
   deps:{
    confirm:async()=>{calls++;return identity;},
    wait:async()=>{calls++;},
    probe:async()=>{calls++;return {
     targetId:target.id,url:target.url,validationLevel:'dom-only' as const,
     checks:[{method:locator.method,expression:locator.expression,status:'found' as const,matchCount:1,
      nodeFingerprint:'a'.repeat(64)}],
    };},
    inspectVisibility:async()=>{calls++;return {
     targetId:target.id,url:target.url,validationLevel:'css-box-read-only' as const,
     status:'potentially-visible' as const,matchCount:1,pointerBlocked:false,
     controlBlocker:'none-detected' as const,interactionVerified:false as const,
     V2:'blocked' as const,V3:'not-configured' as const,V4:'not-configured' as const,
    };},
    inspectListeners:async()=>{calls++;return {
     targetId:target.id,url:target.url,validationLevel:'direct-event-listener-read-only' as const,
     status:'registered' as const,listenerCount:1,eventType:'click' as const,
     interactionVerified:false as const,
     V2:'blocked' as const,V3:'not-configured' as const,V4:'not-configured' as const,
    };},
   },
  });
  await assert.rejects(result,/static|unsupported|selector|CSS|CDP/i);
  assert.equal(calls,0,'infeasible locator cannot be called potentially-ready');
 });
}
