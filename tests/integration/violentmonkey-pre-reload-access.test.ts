import vm from 'node:vm';
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

test('RG-05 disposable Chrome profile Developer Mode is set and read back before the FIRST official fixture',async()=>{
 assert.equal(typeof api.enableDisposableProfileDeveloperMode,'function',
  'missing explicit isolated-profile Developer Mode enable-and-readback gate');
 const calls:Array<{method:string;expression:string}>=[];
 let developerMode=false;
 let mutations=0;
 await api.enableDisposableProfileDeveloperMode(async(method:string,params:any)=>{
  calls.push({method,expression:params.expression});
  assert.equal(method,'Runtime.evaluate');
  assert.equal(params.awaitPromise,true);
  assert.equal(params.returnByValue,true);
  const value=await vm.runInNewContext(params.expression,{
   location:{href:'chrome://extensions/'},
   chrome:{developerPrivate:{
    getProfileConfiguration:async()=>({inDeveloperMode:developerMode,isDeveloperModeControlledByPolicy:false}),
    updateProfileConfiguration:async(value:unknown)=>{
     assert.deepEqual(JSON.parse(JSON.stringify(value)),{inDeveloperMode:true});
     mutations++;developerMode=true;
    },
   }},
  });
  return {result:{value}};
 });
 assert.equal(developerMode,true);
 assert.equal(mutations,1,'configure the disposable profile exactly once');
 assert.equal(calls.length,1);
 assert.doesNotMatch(calls[0].expression,/updateExtensionConfiguration|chrome.runtime.reload/);
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const mktemp=source.indexOf("mkdtemp(join(tmpdir(),'usshm-vm-v4-profile-'))");
 const dev=source.indexOf('await enableDisposableProfileDeveloperMode(extensionsCdp.send)');
 const first=source.indexOf("const createdFixture=await browserCdp.send('Target.createTarget'");
 assert.ok(mktemp>=0&&dev>mktemp&&first>dev,
  'enable Developer Mode only for a new disposable profile BEFORE first fixture');
 assert.match(source,/assertOfficialViolentmonkeyReleaseGate\(blocked\.status\)/,
  'real GM cold restart must remain mandatory');
});

test('RG-05 Developer Mode gate is a no-op when already enabled and rejects wrong Chrome pages or policy refusal',async()=>{
 assert.equal(typeof api.enableDisposableProfileDeveloperMode,'function');
 for(const scenario of [
  {url:'chrome://extensions/',enabled:true,update:0,pass:true},
  {url:'https://account.invalid/',enabled:false,update:0,pass:false},
  {url:'chrome://extensions/',enabled:false,policy:true,update:0,pass:false},
  {url:'chrome://extensions/',enabled:false,refuses:true,update:1,pass:false},
 ]){
  let enabled=scenario.enabled,updates=0;
  const action=api.enableDisposableProfileDeveloperMode(async(_method:string,params:any)=>{
   const value=await vm.runInNewContext(params.expression,{
    location:{href:scenario.url},
    chrome:{developerPrivate:{
     getProfileConfiguration:async()=>({inDeveloperMode:enabled,
      isDeveloperModeControlledByPolicy:!!scenario.policy}),
     updateProfileConfiguration:async()=>{
      updates++;if(!scenario.refuses)enabled=true;
     },
    }},
   });
   return {result:{value}};
  });
  if(scenario.pass)await action;
  else await assert.rejects(action,/Developer Mode|disposable|profile/i);
  assert.equal(updates,scenario.update);
 }
});

test('RG-05 Developer Mode gate rejects forged CDP success envelopes and redacts private errors',async()=>{
 assert.equal(typeof api.enableDisposableProfileDeveloperMode,'function');
 for(const reply of [
  {error:{message:'PRIVATE_CHROME_TOKEN'},result:{value:'enabled'}},
  {exceptionDetails:null,result:{value:'enabled'}},
  {result:{exceptionDetails:false,value:'enabled'}},
  {result:{value:'unavailable'}},
  {result:{value:'enabled',error:0}},
 ]){
  await assert.rejects(api.enableDisposableProfileDeveloperMode(async()=>reply),
   (error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message,/PRIVATE_CHROME_TOKEN/);
    return true;
   });
 }
});
