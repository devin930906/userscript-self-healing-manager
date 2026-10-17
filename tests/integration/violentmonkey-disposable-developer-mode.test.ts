import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

// RG-05: The upstream unpacked-VM cold-start failure coincides with Chrome
// Developer Mode being off in the *disposable* CFT profile. Test an explicit,
// allowlisted change and readback without mutating the manager's real binary,
// per-extension userScripts permission or any real user's Chrome preferences.
function expression():string{
 const method=(contract as Record<string,unknown>).buildViolentmonkeyDisposableDeveloperModeExpression;
 assert.equal(typeof method,'function','Missing RG-05 disposable unpacked Chrome developer-mode control');
 const output=(method as ()=>string)();
 assert.equal(typeof output,'string');
 return output;
}
async function execute(opts:{
 initial?:boolean;updated?:boolean;location?:string;missingApi?:boolean;
 failRead?:boolean; failUpdate?:boolean;
}={}){
 const updates:unknown[]=[];
 let current=opts.initial??false;
 const developerPrivate=opts.missingApi?undefined:{
  async getProfileConfiguration(){
   if(opts.failRead)throw new Error('PRIVATE_EXTENSION_PROFILE_SECRET');
   return {inDeveloperMode:current};
  },
  async updateProfileConfiguration(fields:unknown){
   updates.push({inDeveloperMode:(fields as {inDeveloperMode?:unknown}).inDeveloperMode});
   if(opts.failUpdate)throw new Error('PRIVATE_EXTENSION_PROFILE_SECRET');
   current=opts.updated??true;
  },
 };
 const result=await vm.runInNewContext(expression(),{
  location:{href:opts.location??'chrome://extensions/'},
  chrome:{developerPrivate},
 },{timeout:1000});
 return {result,updates};
}
test('RG-05 enables and reads back developer mode only inside isolated Chrome extensions WebUI',async()=>{
 assert.deepEqual(await execute(),{result:'enabled',updates:[{inDeveloperMode:true}]});
 assert.deepEqual(await execute({initial:true}),{result:'enabled',updates:[]});
});
test('RG-05 never enables global developer mode from another page or absent WebUI API',async()=>{
 assert.deepEqual(await execute({location:'https://private.example/'}),{result:'unavailable',updates:[]});
 assert.deepEqual(await execute({missingApi:true}),{result:'unavailable',updates:[]});
});
test('RG-05 missing readback, API failure, or denied toggle cannot report enabled',async()=>{
 for(const config of [{updated:false},{failRead:true},{failUpdate:true}]){
  const outcome=await execute(config);
  assert.equal(outcome.result,'unavailable');
  assert.equal(outcome.updates.length<=1,true);
  assert.doesNotMatch(String(outcome.result),/PRIVATE_|private[.]example/i);
 }
});
test('RG-05 disposable mode is opt-in, never replaces real GM acceptance',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const workflow=await readFile('.github/workflows/stable-rg05-gate.yml','utf8');
 assert.match(source,/USSHM_RG05_DISPOSABLE_DEV_MODE/);
 assert.match(source,/buildViolentmonkeyDisposableDeveloperModeExpression\(/);
 assert.match(source,/buildViolentmonkeyProfileDeveloperModeExpression\(/);
 assert.match(source,/assertOfficialViolentmonkeyReleaseGate\(blocked\.status\)/);
 assert.match(workflow,/USSHM_RG05_DISPOSABLE_DEV_MODE:\s*'disabled'/);
 assert.doesNotMatch(workflow,/USSHM_RG05_DISPOSABLE_DEV_MODE:\s*'enabled'/,
  'optional Chrome Developer Mode must not block official cold-start GM acceptance');
 assert.match(source,/absoluteRunnerTemp/);
 assert.doesNotMatch(source,/--no-sandbox/);
});


test('RG-05 reconciled parent and child keep genuine official preflight, opted-in WebUI mode and cold-start GM gate',async()=>{
 const smoke=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const contracts=await readFile('scripts/violentmonkey-v4-contract.ts','utf8');
 const setup=smoke.slice(smoke.indexOf("const initiallyAvailable=await probeAccess()"),
  smoke.indexOf("if(!await probeAccess())throw new Error("));
 assert.match(setup,/await extensionsCdp\.send\('Runtime\.enable'\)/,
  'WebUI diagnostics must not run before enabling the pinned CDP Runtime');
 assert.match(setup,/if\(useDisposableDeveloperMode\)\{/,
  'changing the disposable Chrome profile remains opt-in');
 assert.match(setup,/buildViolentmonkeyDisposableDeveloperModeExpression\(\)/);
 assert.match(setup,/await enableDisposableProfileDeveloperMode\(extensionsCdp\.send\)/);
 assert.ok(setup.indexOf("await enableDisposableProfileDeveloperMode(extensionsCdp.send)")>
  setup.indexOf("if(useDisposableDeveloperMode){"),
  'parent bounded readback runs only inside the child opt-in scope');
 assert.match(setup,/if\(!initiallyAvailable\)/);
 assert.match(setup,/await enableViolentmonkeyUserScriptsAccess\(extensionsCdp\.send\)/);
 assert.match(setup,/extensionsCdp\?\.close\(\)/,
  'Chrome internal WebUI CDP socket must be closed after setup failure');
 for(const method of ['assertViolentmonkeyPreflightReceipt(answer)',
  'assertViolentmonkeyRestartPermissionReceipt(permission)',
  'readViolentmonkeyManagerDiagnosticCdpValue(auditResponse,256)',
  'assertOfficialViolentmonkeyReleaseGate(blocked.status)'])
  assert.ok(smoke.includes(method),'no parent manager evidence or GM gate can be dropped: '+method);
 assert.match(contracts,/export function readViolentmonkeyManagerDiagnosticCdpValue/);
 assert.match(contracts,/export async function enableDisposableProfileDeveloperMode/);
 assert.doesNotMatch(smoke,/--no-sandbox/);
});
