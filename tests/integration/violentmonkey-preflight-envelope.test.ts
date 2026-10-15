import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const api=contract as Record<string,unknown>;
const receipt=(found:boolean)=>JSON.stringify({found});
const unsafe='PRIVATE_MANAGER_PREFLIGHT_TOKEN https://private.invalid/token';

test('RG-05 manager preflight credits only an exact own-data CDP receipt',()=>{
 assert.equal(typeof api.assertViolentmonkeyPreflightReceipt,'function',
  'missing strict RG-05 manager GetData preflight receipt validator');
 const verify=api.assertViolentmonkeyPreflightReceipt as (response:unknown)=>{found:boolean};
 for(const found of [true,false]){
  assert.deepEqual(verify({result:{value:receipt(found)}}),{found},
   'clean positive/negative controls must retain their original meaning');
 }
 for(const response of [
  null,{}, {result:{}}, {result:{value:receipt(true),error:0}},
  {error:false,result:{value:receipt(true)}},
  {exceptionDetails:null,result:{value:receipt(true)}},
  {result:{exceptionDetails:'',value:receipt(true)}},
  Object.assign(Object.create({error:unsafe}),{result:{value:receipt(true)}}),
  {result:Object.assign(Object.create({exceptionDetails:undefined}),{value:receipt(true)})},
  Object.create({result:{value:receipt(true)}}),
  {result:Object.create({value:receipt(true)})},
  {result:{value:'PRIVATE_SOURCE '+unsafe}},
  {result:{value:JSON.stringify({found:true,extra:unsafe})}},
  {result:{value:JSON.stringify({found:true,failed:false})}},
  {result:{value:JSON.stringify({failed:true,found:true})}},
  {result:{value:JSON.stringify({found:'true'})}},
  {result:{value:JSON.stringify({found:false,extra:false})}},
 ]){
  assert.throws(()=>verify(response),(error:unknown)=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Violentmonkey read-only preflight returned an invalid fixed receipt');
   assert.doesNotMatch(error.message,/PRIVATE_|private[.]invalid|token/);
   assert.equal('cause' in error,false);
   return true;
  });
 }
});

test('RG-07 preflight cannot invoke hostile protocol accessors or reflect their values',()=>{
 assert.equal(typeof api.assertViolentmonkeyPreflightReceipt,'function');
 const verify=api.assertViolentmonkeyPreflightReceipt as (response:unknown)=>{found:boolean};
 let accesses=0;
 const getter=()=>{accesses++;throw Error(unsafe);};
 for(const reply of [
  Object.defineProperty({},'result',{get:getter}),
  {result:Object.defineProperty({},'value',{get:getter})},
  Object.defineProperty({result:{value:receipt(true)}},'error',{get:getter}),
  {result:Object.defineProperty({value:receipt(true)},'exceptionDetails',{get:getter})},
 ]){
  assert.throws(()=>verify(reply),/invalid fixed receipt/);
 }
 assert.equal(accesses,0,'no CDP response getter may execute');
});

test('RG-05 official preflight uses strict validator both before and after Chrome restart',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const start=source.indexOf('async function readManagerPreflight(');
 const end=source.indexOf('async function readManagerInjectionOptions(',start);
 assert.ok(start>=0&&end>start,'manager preflight must have a distinct bounded code path');
 const preflight=source.slice(start,end);
 assert.match(preflight,/assertViolentmonkeyPreflightReceipt\(answer\)/);
 assert.doesNotMatch(preflight,/value=answer\.result\?\.value/,
  'this preflight must not credit an unchecked CDP value');
 assert.match(source,/const preflightReceipt=await readManagerPreflight/);
 assert.match(source,/const retainedScript=await readManagerPreflight/);
});
