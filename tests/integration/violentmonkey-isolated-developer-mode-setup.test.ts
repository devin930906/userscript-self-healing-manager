import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const api=contract as any;
const decode=async(expression:string,profile:any,actualUrl='chrome://extensions/')=>{
 let updates=0;
 const value=await vm.runInNewContext(expression,{
  location:{href:actualUrl},JSON,
  chrome:{developerPrivate:{
   async getProfileConfiguration(){return {inDeveloperMode:profile.mode,PRIVATE_PATH:'SENSITIVE_DATA'};},
   async updateProfileConfiguration(options:any){
    assert.deepEqual(JSON.parse(JSON.stringify(options)),{inDeveloperMode:true});
    updates++;profile.mode=profile.allowReadback?true:false;
   },
  }},
 });
 return {value,updates};
};

test('RG-05 isolated developer mode setup enables ONLY the temporary profile and checks readback',async()=>{
 assert.equal(typeof api.buildViolentmonkeyIsolatedDeveloperModeSetupExpression,'function');
 const expression=api.buildViolentmonkeyIsolatedDeveloperModeSetupExpression();
 const profile={mode:false,allowReadback:true};
 const first=await decode(expression,profile);
 assert.equal(first.value,JSON.stringify({ready:true,changed:true}));
 assert.equal(first.updates,1);
 const second=await decode(expression,profile);
 assert.equal(second.value,JSON.stringify({ready:true,changed:false}));
 assert.equal(second.updates,0);
 assert.doesNotMatch(first.value,/SENSITIVE_DATA|PRIVATE_PATH/);
 assert.doesNotMatch(expression,/userScriptsAccess|chrome\.runtime\.reload\(\)|window\.eval\(/);
});

test('RG-05 isolated developer mode setup fails closed on wrong WebUI, unavailable API and denied readback',async()=>{
 const expression=api.buildViolentmonkeyIsolatedDeveloperModeSetupExpression();
 const profile={mode:false,allowReadback:true};
 const wrong=await decode(expression,profile,'https://private.example/');
 assert.equal(wrong.value,JSON.stringify({ready:false,reason:'page-context'}));
 assert.equal(wrong.updates,0);
 const unsupported=await vm.runInNewContext(expression,{location:{href:'chrome://extensions/'},chrome:{},JSON});
 assert.equal(unsupported,JSON.stringify({ready:false,reason:'settings-api'}));
 const denied=await decode(expression,{mode:false,allowReadback:false});
 assert.equal(denied.value,JSON.stringify({ready:false,reason:'readback'}));
 assert.doesNotMatch(denied.value,/SENSITIVE_DATA/);
 const invalid=await decode(expression,{mode:'enabled',allowReadback:true});
 assert.equal(invalid.value,JSON.stringify({ready:false,reason:'invalid-state'}));
 assert.equal(invalid.updates,0,'invalid profile state must never be mutated');
});

test('RG-05 isolated Chrome bootstrap enables developer mode before official manager GM fixture',async()=>{
 const src=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const tempGuard=src.indexOf('const absoluteRunnerTemp=resolve(runnerTemp)');
 const setup=src.indexOf('await enableIsolatedViolentmonkeyDeveloperMode(');
 const firstReady=src.indexOf('await waitForVerifiedViolentmonkeyInjector({');
 const fixtureInstall=src.indexOf('const installExpression=buildViolentmonkeyFixtureInstallExpression(');
 assert.ok(tempGuard>=0&&setup>tempGuard&&firstReady>setup&&fixtureInstall>firstReady);
 assert.match(src,/USSHM-ChromeForTesting-155/);
 assert.match(src,/usshm-vm-v4-profile-/);
 assert.doesNotMatch(src,/chrome\.developerPrivate\.updateProfileConfiguration\(/,
  'CI main harness must use only the fixed bounded setup expression');
});
