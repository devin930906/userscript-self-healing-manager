import assert from 'node:assert/strict';
import {test} from 'node:test';
import {enableViolentmonkeyUserScriptsAccess} from '../../scripts/violentmonkey-v4-contract.ts';

const ready=JSON.stringify({available:true});
const privateDetails='PRIVATE_CDP_PERMISSION_TOKEN https://private.invalid/secret';

test('RG-05 permission gate rejects CDP error envelopes even with a forged positive receipt',async()=>{
 for(const reply of [
  {error:null,result:{value:ready}},
  {exceptionDetails:false,result:{value:ready}},
  {result:{error:0,value:ready}},
  {result:{exceptionDetails:null,value:ready}},
 ]){
  let calls=0,sleeps=0;
  await assert.rejects(
   enableViolentmonkeyUserScriptsAccess(async()=>{calls++;return reply;},
    async()=>{sleeps++;}),
   (error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Pinned unpacked manager Allow User Scripts CDP evaluation failed');
    return true;
   },
  );
  assert.equal(calls,1,'transport failure must not be retried or accepted');
  assert.equal(sleeps,0);
 }
});

test('RG-05 permission gate rejects inherited and accessor CDP values without executing getters',async()=>{
 let getterCalls=0;
 const forged=[
  Object.create({result:{value:ready}}),
  {result:Object.create({value:ready})},
  Object.defineProperty({},'result',{enumerable:true,get(){getterCalls++;throw Error(privateDetails);}}),
  {result:Object.defineProperty({},'value',{enumerable:true,get(){getterCalls++;throw Error(privateDetails);}})},
  Object.defineProperty({result:{value:ready}},'error',{enumerable:true,get(){getterCalls++;throw Error(privateDetails);}}),
 ];
 for(const reply of forged){
  let calls=0,sleeps=0;
  await assert.rejects(enableViolentmonkeyUserScriptsAccess(async()=>{calls++;return reply;},
   async()=>{sleeps++;}),
   (error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Pinned unpacked manager Allow User Scripts CDP evaluation failed');
    assert.doesNotMatch(error.message,/PRIVATE_|private[.]invalid/);
    assert.equal('cause' in error,false);
    return true;
   });
  assert.equal(calls,1);
  assert.equal(sleeps,0);
 }
 assert.equal(getterCalls,0,'validation must inspect descriptors rather than invoke hostile getters');
});

test('RG-05 permission gate still accepts one clean official permission receipt',async()=>{
 let calls=0;
 await enableViolentmonkeyUserScriptsAccess(async()=>{calls++;return {result:{value:ready}};},
  async()=>{throw Error('clean positive receipt must not retry');});
 assert.equal(calls,1);
});

test('RG-05 permission gate rejects inherited protocol faults despite own success data',async()=>{
 const inheritedFaults=[
  Object.assign(Object.create({error:privateDetails}),{result:{value:ready}}),
  Object.assign(Object.create({exceptionDetails:null}),{result:{value:ready}}),
  {result:Object.assign(Object.create({error:privateDetails}),{value:ready})},
  {result:Object.assign(Object.create({exceptionDetails:false}),{value:ready})},
 ];
 for(const reply of inheritedFaults){
  let calls=0,sleeps=0;
  await assert.rejects(enableViolentmonkeyUserScriptsAccess(async()=>{calls++;return reply;},
   async()=>{sleeps++;}),
   (error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Pinned unpacked manager Allow User Scripts CDP evaluation failed');
    assert.doesNotMatch(error.message,/PRIVATE_|private[.]invalid/);
    return true;
   });
  assert.equal(calls,1);
  assert.equal(sleeps,0);
 }
});
