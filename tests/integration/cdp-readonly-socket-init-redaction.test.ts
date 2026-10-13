import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inspectReadOnlyElementVisibility} from '../../packages/cdp-client/src/read-only-visibility.ts';
import {inspectReadOnlyEventListeners} from '../../packages/cdp-client/src/read-only-event-listeners.ts';

const target={id:'synthetic-target',type:'page',url:'https://fixture.example.invalid/',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/synthetic-target'};
const locator={method:'querySelector' as const,expression:'#submit',runtimeRequired:false};

test('RG-07 CDP visibility/listener socket factories cannot export private initialization exceptions',async()=>{
 const sensitive='PRIVATE_PROFILE_TOKEN file:///C:/Users/SECRET_USER/Desktop/SECRET_SCRIPT.user.js';
 for(const [name,inspect,expected] of [
  ['visibility',inspectReadOnlyElementVisibility,'CDP visibility socket initialization failed'],
  ['listeners',inspectReadOnlyEventListeners,'CDP listener socket initialization failed'],
 ] as const){
  for(const failure of [new Error(sensitive),{message:sensitive},sensitive]){
   let starts=0;
   await assert.rejects(inspect(target,locator,{
    socketFactory:()=>{starts++;throw failure;},
   }),(error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,expected,name);
    assert.equal('cause' in error,false,'do not retain untrusted browser errors');
    assert.doesNotMatch(String(error),/PRIVATE_|SECRET_USER|SECRET_SCRIPT|file:\/\//);
    return true;
   });
   assert.equal(starts,1,'do not retry a failed CDP transport construction');
  }
 }
});
