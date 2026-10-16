import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {readVerifiedOfficialManagerCdpReply} from '../../scripts/violentmonkey-cdp-transport-reply.ts';

test('RG-05 isolated manager CDP transport accepts only explicit successful result objects',()=>{
 assert.deepEqual(readVerifiedOfficialManagerCdpReply({result:{}}),{});
 assert.deepEqual(readVerifiedOfficialManagerCdpReply({result:{value:'fixed-fixture'}}),
  {value:'fixed-fixture'});
});

test('RG-05 falsy protocol error envelopes never turn into official manager evidence',()=>{
 for(const errorValue of [null,false,0,'']){
  const raw='PRIVATE_GM_ERROR_SENTINEL';
  assert.throws(
   ()=>readVerifiedOfficialManagerCdpReply({error:errorValue,result:{value:raw}}),
   error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'CDP command failed');
    assert.doesNotMatch(error.message,/PRIVATE_GM_ERROR_SENTINEL/);
    assert.equal('cause' in error,false);
    return true;
   });
 }
});

test('RG-05 malformed or accessor-backed CDP command responses fail closed',()=>{
 const privateValue='PRIVATE_GM_RESPONSE_SENTINEL';
 const forged=Object.create({error:{message:privateValue}});
 Object.defineProperty(forged,'result',{value:{value:true},enumerable:true});
 const accessor={};
 Object.defineProperty(accessor,'result',{get(){throw Error(privateValue);}});
 for(const reply of [null,false,[],{}, {result:null},{result:[]},
  {result:'ok'},{exceptionDetails:0,result:{}},forged,accessor]){
  assert.throws(()=>readVerifiedOfficialManagerCdpReply(reply),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'CDP command failed');
   assert.doesNotMatch(error.message,/PRIVATE_GM_RESPONSE_SENTINEL/);
   return true;
  });
 }
});

test('RG-05 real official manager socket uses fail-closed CDP receipt validation',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 assert.match(source,/readVerifiedOfficialManagerCdpReply\(response\)/);
 assert.doesNotMatch(source,/if\(response\.error\)/);
});
