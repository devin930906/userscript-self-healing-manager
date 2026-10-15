import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const api=contract as any;
const goodStatus={matched:false,enabled:false,active:false};
const disabledReason={reason:'state-disabled-unsupported-developer'};
const cdpreply=(value:unknown)=>({result:{type:'string',value:JSON.stringify(value)}});

test('RG-05 passive pre-reload access diagnostic distinguishes observed disabled state without modifying extension',async()=>{
 assert.equal(typeof api.readViolentmonkeyPreReloadAccess,'function');
 const expressions:string[]=[];
 const result=await api.readViolentmonkeyPreReloadAccess(async(method:string,params:any)=>{
  assert.equal(method,'Runtime.evaluate');
  assert.deepEqual({awaitPromise:params.awaitPromise,returnByValue:params.returnByValue},
   {awaitPromise:true,returnByValue:true});
  expressions.push(params.expression);
  if(expressions.length===1)return cdpreply(goodStatus);
  if(expressions.length===2)return cdpreply(disabledReason);
  throw Error('unexpected extra CDP request');
 });
 assert.deepEqual(result,{observed:true,matched:false,enabled:false,active:false,
  reason:'state-disabled-unsupported-developer'});
 assert.deepEqual(expressions,[
  contract.buildViolentmonkeyUserScriptsAccessStatusExpression(),
  contract.buildViolentmonkeyUserScriptsAccessReasonExpression(),
 ]);
 assert.ok(expressions.every(expr=>!expr.includes('updateExtensionConfiguration')&&
  !expr.includes('chrome.runtime.reload()')),'this diagnostic must be passive');
});

test('RG-05 passive access diagnostic preserves a genuinely active control observation',async()=>{
 assert.equal(typeof api.readViolentmonkeyPreReloadAccess,'function');
 let calls=0;
 const value=await api.readViolentmonkeyPreReloadAccess(async()=>{
  calls++;
  return calls===1?cdpreply({matched:true,enabled:true,active:true}):
   cdpreply({reason:'active'});
 });
 assert.equal(calls,2);
 assert.deepEqual(value,{observed:true,matched:true,enabled:true,active:true,reason:'active'});
});

test('RG-05 malformed or contradictory CDP access receipts fail closed and do not leak private details',async()=>{
 assert.equal(typeof api.readViolentmonkeyPreReloadAccess,'function');
 const absent={observed:false,matched:false,enabled:false,active:false,reason:'unavailable'};
 const privateToken='PRIVATE_MANAGER_CDP_DIAGNOSTIC';
 const scenarios=[
  [cdpreply({matched:true,enabled:false,active:true}),cdpreply({reason:'active'})],
  [cdpreply({matched:false,enabled:false,active:false}),cdpreply({reason:'active'})],
  [cdpreply(goodStatus),cdpreply({reason:privateToken})],
  [{error:null,...cdpreply(goodStatus)},cdpreply(disabledReason)],
  [{exceptionDetails:null,...cdpreply(goodStatus)},cdpreply(disabledReason)],
  [cdpreply(goodStatus),{result:{error:false,value:JSON.stringify(disabledReason)}}],
  [cdpreply(goodStatus),{result:{value:JSON.stringify(disabledReason),exceptionDetails:null}}],
  [{result:{value:privateToken}},cdpreply(disabledReason)],
 ];
 for(const sequence of scenarios){
  let index=0;
  const value=await api.readViolentmonkeyPreReloadAccess(async()=>sequence[index++]);
  assert.deepEqual(value,absent);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE_MANAGER_CDP_DIAGNOSTIC/);
 }
 const failure=await api.readViolentmonkeyPreReloadAccess(async()=>{throw Error(privateToken);});
 assert.deepEqual(failure,absent);
});

test('RG-05 pre-reload state evidence is collected only after two genuine GM misses and before extension reload',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const blocked=source.indexOf('const blocked=classifyOfficialViolentmonkeyRestartBlocker({');
 const before=source.indexOf('const preReloadAccess=await collectPreReloadViolentmonkeyAccess({');
 const reload=source.indexOf('const reloadDiagnostic=await runPostBlockerExtensionReloadDiagnostic({');
 const gate=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(blocked>=0&&before>blocked&&reload>before&&gate>reload,
  'read-only pre-reload sample must never run before the failure is proven or alter cold-start acceptance');
 assert.match(source,/RG-05 access before extension reload:/);
 assert.doesNotMatch(source,/console\.log\([^\n]*preReloadAccess[^\n]*(?:error\.message|stack|path|source)/i);
});
