import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const api=contract as any;

test('RG-05 read-only developer mode probe reports only current disposable Chrome profile state',async()=>{
 assert.equal(typeof api.buildViolentmonkeyProfileDeveloperModeExpression,'function');
 const expression=api.buildViolentmonkeyProfileDeveloperModeExpression();
 for(const [mode,expected] of [[true,'enabled'],[false,'disabled']] as const){
  let calls=0;
  const result=await vm.runInNewContext(expression,{
   location:{href:'chrome://extensions/'},
   chrome:{developerPrivate:{
    async getProfileConfiguration(){calls++;return{
     inDeveloperMode:mode,privateProfilePath:'PRIVATE_PROFILE_PATH',
     isDeveloperModeControlledByPolicy:true,
    };}
   }},
  });
  assert.equal(result,expected);assert.equal(calls,1);
  assert.doesNotMatch(result,/PRIVATE_PROFILE_PATH|controlledByPolicy/);
 }
 assert.doesNotMatch(expression,/updateProfileConfiguration|updateExtensionConfiguration|runtime\.reload/);
});

test('RG-05 developer mode probe fails closed for wrong page, unavailable Chrome API or private failure',async()=>{
 assert.equal(typeof api.buildViolentmonkeyProfileDeveloperModeExpression,'function');
 const expression=api.buildViolentmonkeyProfileDeveloperModeExpression();
 let calls=0;
 assert.equal(await vm.runInNewContext(expression,{
  location:{href:'https://private.example/'},
  chrome:{developerPrivate:{async getProfileConfiguration(){calls++;return {inDeveloperMode:true};}}},
 }), 'unavailable');
 assert.equal(calls,0);
 assert.equal(await vm.runInNewContext(expression,{location:{href:'chrome://extensions/'},chrome:{}}),'unavailable');
 assert.equal(await vm.runInNewContext(expression,{
  location:{href:'chrome://extensions/'},chrome:{developerPrivate:{
   async getProfileConfiguration(){throw Error('PRIVATE_PROFILE_ERROR');}
  }}
 }), 'unavailable');
 assert.equal(await vm.runInNewContext(expression,{
  location:{href:'chrome://extensions/'},chrome:{developerPrivate:{
   async getProfileConfiguration(){return {inDeveloperMode:'true'};}
  }}
 }), 'unavailable');
});

test('RG-05 post-blocker extension reload must not change a developer-mode-off fixture',async()=>{
 const src=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const classified=src.indexOf('const blocked=classifyOfficialViolentmonkeyRestartBlocker({');
 const read=src.indexOf('const preReloadAccess=await collectPreReloadViolentmonkeyAccess({');
 const reload=src.indexOf('const reloadDiagnostic=await runPostBlockerExtensionReloadDiagnostic({');
 const gate=src.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(classified>=0&&read>classified&&reload>read&&gate>reload);
 assert.match(src,/buildViolentmonkeyProfileDeveloperModeExpression\(\)/);
 assert.match(src,/profileDeveloperMode==='enabled'/);
 assert.match(src,/reload-skipped-unsafe-profile/);
 assert.match(src,/if\(!allowReload\)/);
 assert.doesNotMatch(src,/updateProfileConfiguration\(/,
  'fixture diagnosis cannot secretly enable Developer Mode even in a disposable Chrome profile');
});
