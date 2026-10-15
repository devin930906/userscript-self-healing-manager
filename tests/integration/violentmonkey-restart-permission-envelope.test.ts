import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const exact=JSON.stringify({available:true});
const access=(contract as Record<string,unknown>).assertViolentmonkeyRestartPermissionReceipt;

test('RG-05 after true Chrome restart only an own-data positive permission receipt is accepted',()=>{
 assert.equal(typeof access,'function','missing strict process-restart permission receipt validator');
 const verify=access as (response:unknown)=>true;
 assert.equal(verify({result:{type:'string',value:exact}}),true);
 for(const reply of [
  null,{}, {result:{value:null}},{result:{value:JSON.stringify({available:false})}},
  {result:{value:'PRIVATE_EXTENSION_INTERNAL_ERROR'}},
  Object.create({result:{value:exact}}),
  {result:Object.create({value:exact})},
  {error:false,result:{value:exact}},
  {exceptionDetails:null,result:{value:exact}},
  {result:{error:0,value:exact}},
  {result:{exceptionDetails:'',value:exact}},
  Object.assign(Object.create({error:'PRIVATE_ERROR'}),{result:{value:exact}}),
  {result:Object.assign(Object.create({exceptionDetails:null}),{value:exact})},
 ]){
  assert.throws(()=>verify(reply),(error:unknown)=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Pinned manager userScripts permission not retained across process restart');
   assert.equal('cause' in error,false);
   return true;
  });
 }
});

test('RG-07 restart permission inspection must not execute CDP getters or leak their content',()=>{
 assert.equal(typeof access,'function');
 const verify=access as (response:unknown)=>true;
 let called=0;
 const getter=()=>{called++;throw new Error('PRIVATE_RESTART_PERMISSION_GETTER_SECRET');};
 for(const reply of [
  Object.defineProperty({},'result',{get:getter}),
  {result:Object.defineProperty({},'value',{get:getter})},
  Object.defineProperty({result:{value:exact}},'error',{get:getter}),
  {result:Object.defineProperty({value:exact},'exceptionDetails',{get:getter})},
 ]){
  assert.throws(()=>verify(reply),(error:unknown)=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Pinned manager userScripts permission not retained across process restart');
   assert.doesNotMatch(error.message,/PRIVATE_/);
   return true;
  });
 }
 assert.equal(called,0);
});

test('RG-05 actual official restart smoke gates permission before any manager GM proof',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const permission=source.indexOf('const permission=await optionsCdp.send(');
 const strict=source.indexOf('assertViolentmonkeyRestartPermissionReceipt(permission)');
 const official=source.indexOf('await waitForVerifiedViolentmonkeyInjector({',permission);
 assert.ok(permission>=0&&strict>permission&&strict<official,
  'validate official permission CDP envelope before reusing restarted manager');
 assert.doesNotMatch(source,/permission\.result\?\.value===JSON\.stringify\(\{available:true\}\)/,
  'blocker classification must never trust an unchecked success field');
});
