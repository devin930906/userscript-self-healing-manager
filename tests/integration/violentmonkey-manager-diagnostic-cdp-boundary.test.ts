import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const method=(contract as Record<string,unknown>).readViolentmonkeyManagerDiagnosticCdpValue;
const secret='PRIVATE_RG05_DIAGNOSTIC_ERROR https://private.invalid/token';

test('RG-05 manager read-only diagnostic accepts only clean own-data CDP values',()=>{
 assert.equal(typeof method,'function','missing bounded manager CDP protocol envelope validator');
 const read=method as (reply:unknown,maxBytes:number)=>string;
 for(const [max,text] of [[80,'{"matched":true}'],[160,'{"applied":true}']] as const)
  assert.equal(read({result:{type:'string',value:text}},max),text);
 for(const invalid of [
  {error:false,result:{value:'{"matched":true}'}},
  {exceptionDetails:null,result:{value:'{"matched":true}'}},
  {result:{error:0,value:'{"matched":true}'}},
  {result:{exceptionDetails:'',value:'{"matched":true}'}},
  Object.create({result:{value:'{"matched":true}'}}),
  {result:Object.create({value:'{"matched":true}'})},
  Object.assign(Object.create({error:secret}),{result:{value:'{"matched":true}'}}),
  {result:Object.assign(Object.create({exceptionDetails:false}),{value:'{"matched":true}'})},
  {result:{value:42}},
  {result:{value:'x'.repeat(81)}},
 ]){
  assert.throws(()=>read(invalid,80),(error:unknown)=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Isolated manager diagnostic CDP envelope invalid');
   assert.doesNotMatch(error.message,/PRIVATE_|private[.]invalid|token/);
   assert.equal('cause' in error,false);
   return true;
  });
 }
 assert.throws(()=>read({result:{value:'ok'}},81),/diagnostic CDP envelope invalid/);
});

test('RG-07 manager read-only diagnostic never invokes hostile CDP getters',()=>{
 assert.equal(typeof method,'function');
 const read=method as (reply:unknown,maxBytes:number)=>string;
 let calls=0;
 const getter=()=>{calls++;throw Error(secret);};
 for(const reply of [
  Object.defineProperty({},'result',{get:getter}),
  {result:Object.defineProperty({},'value',{get:getter})},
  Object.defineProperty({result:{value:'{"matched":true}'}},'error',{get:getter}),
  {result:Object.defineProperty({value:'{"matched":true}'},'exceptionDetails',{get:getter})},
 ]){
  assert.throws(()=>read(reply,80),/Isolated manager diagnostic CDP envelope invalid/);
 }
 assert.equal(calls,0);
});

test('RG-05 four official manager diagnostics validate protocol envelopes before trusting data',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const sections=[
  ['readManagerInjectionOptions','readManagerFixtureMatch',160],
  ['readManagerFixtureMatch','readManagerFixtureRegistration',80],
  ['readManagerFixtureRegistration','readManagerWorldConfiguration',160],
  ['readManagerWorldConfiguration','const profile=await mkdtemp',160],
 ] as const;
 for(const [name,next,maxBytes] of sections){
  const begin=source.indexOf('async function '+name+'(');
  const end=source.indexOf(next.startsWith('const profile')?next:'async function '+next+'(',begin+1);
  assert.ok(begin>=0&&end>begin,'must find separate '+name+' adapter');
  const segment=source.slice(begin,end);
  assert.ok(segment.includes('readViolentmonkeyManagerDiagnosticCdpValue('),
   name+' must reject protocol errors before accepting a bounded manager receipt');
  assert.match(segment,new RegExp('readViolentmonkeyManagerDiagnosticCdpValue\\([^,]+,'+maxBytes+'\\)'));
  assert.doesNotMatch(segment,/\.result\?\.value/,
   name+' must not read nested CDP result fields outside the shared validator');
 }
});


test('RG-05 post-restart persisted official manager configuration uses an exact bounded CDP receipt',()=>{
 assert.equal(typeof method,'function');
 const read=method as (reply:unknown,maxBytes:number)=>string;
 const exact=JSON.stringify({present:true,enabled:true,scope:true,gmGrants:true});
 assert.equal(read({result:{type:'string',value:exact}},256),exact);
 assert.throws(()=>read({result:{value:'x'.repeat(257)}},256),
  /Isolated manager diagnostic CDP envelope invalid/);
 for(const invalid of [
  {error:false,result:{value:exact}},
  {result:{exceptionDetails:null,value:exact}},
  Object.create({result:{value:exact}}),
 ]){
  assert.throws(()=>read(invalid,256),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Isolated manager diagnostic CDP envelope invalid');
   return true;
  });
 }
});

test('RG-05 real Chrome restart configuration audit refuses unchecked CDP success fields',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const begin=source.indexOf('const auditResponse=await optionsCdp.send(');
 const end=source.indexOf('const resumedManagers=await inspectKnownUserscriptManagerTargets(',begin);
 assert.ok(begin>=0&&end>begin,'find authentic post-restart persisted manager configuration gate');
 const check=source.slice(begin,end);
 assert.match(check,/readViolentmonkeyManagerDiagnosticCdpValue\(auditResponse,256\)/);
 assert.doesNotMatch(check,/auditResponse\.result\?\.value/,
  'post-restart inventory may not be credited from unchecked CDP success value');
 assert.match(check,/persistedConfig\.present===true/);
 assert.match(check,/persistedConfig\.enabled===true/);
 assert.match(check,/persistedConfig\.scope===true/);
 assert.match(check,/persistedConfig\.gmGrants===true/);
});
