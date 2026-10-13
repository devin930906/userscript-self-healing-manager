import assert from 'node:assert/strict';
import {test} from 'node:test';
import {enableViolentmonkeyUserScriptsAccess} from '../../scripts/violentmonkey-v4-contract.ts';

test('RG-07 isolated official-manager permission setup redacts rejected CDP errors',async()=>{
 const sensitive='PRIVATE_CDP_SETTINGS_TOKEN https://private.invalid/user?token=SECRET';
 for(const rejected of [new Error(sensitive),{message:sensitive},sensitive]){
  let calls=0,pauses=0;
  await assert.rejects(
   enableViolentmonkeyUserScriptsAccess(async(method:string)=>{
    assert.equal(method,'Runtime.evaluate');
    calls++;
    throw rejected;
   },async()=>{pauses++;}),
   (error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Pinned unpacked manager Allow User Scripts CDP evaluation failed');
    assert.doesNotMatch(error.message,/PRIVATE_|SECRET|private[.]invalid|token=/);
    assert.equal('cause' in error,false,'do not retain untrusted Chrome exceptions as a cause');
    return true;
   },
  );
  assert.equal(calls,1,'a CDP transport error must fail closed without retries');
  assert.equal(pauses,0,'only explicit bounded readiness states are eligible for retries');
 }
});

test('RG-07 pinned extension permission healthy readback still succeeds on one official receipt',async()=>{
 let calls=0;
 await enableViolentmonkeyUserScriptsAccess(async method=>{
  assert.equal(method,'Runtime.evaluate');
  calls++;
  return {result:{value:JSON.stringify({available:true})}};
 },async()=>{throw Error('healthy receipt must never sleep');});
 assert.equal(calls,1);
});
