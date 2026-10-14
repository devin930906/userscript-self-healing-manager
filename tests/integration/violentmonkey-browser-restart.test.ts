import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
const fixture={
 storageBefore:2,storageAfter:3,storageReadback:3,
 menuCommandId:'usshm-v4-fixture-menu',requestStatus:200,requestBody:'USSHM_GM_REQUEST_OK',
};
const before={pid:4100,browserSocket:'ws://127.0.0.1:9223/devtools/browser/session-one',
 frameId:'frame-one',loaderId:'loader-one'};
const after={pid:4200,browserSocket:'ws://127.0.0.1:9223/devtools/browser/session-two',
 frameId:'frame-two',loaderId:'loader-two'};
const input={before,after,chromeProduct:'Chrome/155.0.8059.39',
 managerVersion:'2.49.0',managerExtensionId:'jinjaccalgkegednnccohejagnlnfdag',
 observedManagers:['violentmonkey'],appV4:'not-configured',appManagerVerified:false,
 fixture,loopbackRequestsObserved:3,expectedStorageBefore:2};
async function requireAttestation(){
 const module=await import('../../scripts/violentmonkey-restart-attestation.ts').catch(()=>({} as Record<string,unknown>));
 assert.equal(typeof (module as any).assertOfficialViolentmonkeyProcessRestart,'function',
  'RG-05 official-manager Chrome process restart attestation is not implemented');
 return (module as any).assertOfficialViolentmonkeyProcessRestart as (input:unknown)=>any;
}
test('RG-05 official manager fixture survives a genuinely new Chrome process, remains test-only and cannot pass app V4',async()=>{
 const verify=await requireAttestation();
 const output=verify(input);
 assert.equal(output.status,'fixture-restart-passed');
 assert.equal(output.validationLevel,'isolated-manager-process-restart');
 assert.equal(output.storageBefore,2);
 assert.equal(output.storageAfter,3);
 assert.equal(output.productionEligible,false);
 assert.equal(output.V4,'not-configured');
 assert.equal(output.managerVerified,false);
 assert.equal(output.functionalVerified,false);
 assert.equal(output.requestsObserved,3);
 assert.equal(Object.keys(output).includes('browserSocket'),false);
 assert.equal(Object.keys(output).includes('pid'),false);
});
test('RG-05 restart must fail closed on recycled process, endpoint, frame or loader evidence',async()=>{
 const verify=await requireAttestation();
 for(const mutated of [
  {after:{...after,pid:before.pid}},
  {after:{...after,browserSocket:before.browserSocket}},
  {after:{...after,frameId:before.frameId}},
  {after:{...after,loaderId:before.loaderId}},
  {after:{...after,browserSocket:'ws://example.org:9223/devtools/browser/session-two'}},
  {before:{...before,pid:0}},
  {after:{...after,pid:1.1}},
  {loopbackRequestsObserved:2},
  {loopbackRequestsObserved:4},
  {fixture:{...fixture,storageBefore:1}},
  {fixture:{...fixture,storageReadback:2}},
  {observedManagers:[]},
  {appV4:'passed'},
  {appManagerVerified:true},
  {chromeProduct:'Chrome/156.0.0.0'},
  {managerVersion:'2.49.1'},
 ]){
  assert.throws(()=>verify({...input,...mutated}),/manager|restart|identity|fixture|incomplete|inconsistent|invalid/i);
 }
});
test('RG-05 actual official CFT 155 fixture smoke performs independent Chrome process restart on the SAME disposable profile',async()=>{
 const code=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 assert.match(code,/assertOfficialViolentmonkeyProcessRestart/);
 assert.match(code,/const profile=await mkdtemp\(/);
 assert.match(code,/spawnSync\('taskkill'/);
 assert.match(code,/previousChromePid/);
 assert.match(code,/beforeRestartIdentity/);
 assert.match(code,/await readManagerPreflight\(optionsCdp,\(\)=>exited\)/);
 assert.match(code,/fixture-restart-passed/);
 assert.match(code,/requests\.length,3/);
 assert.match(code,/expectedStorageBefore:2/);
 assert.doesNotMatch(code,/appV4:'passed'|managerVerified:true|--no-sandbox/i);
});

test('RG-05 official manager restart reports one required cold-start fixture reload distinctly from immediate injection',async()=>{
 const attest=await requireAttestation();
 const warmup=attest({...input,startupWarmup:true});
 assert.equal(warmup.status,'fixture-restart-warmup-passed');
 assert.equal(warmup.coldStartInjection,'reload-required');
 assert.equal(warmup.productionEligible,false);
 assert.equal(warmup.V4,'not-configured');
 assert.equal(warmup.managerVerified,false);
 assert.throws(()=>attest({...input,startupWarmup:'yes'}),/restart|invalid|fixture|incomplete/i);
});
test('RG-05 live official manager cold-start recovery is one bounded loopback reload only on missing fixture marker',async()=>{
 const script=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 assert.match(script,/stage: not-observed/);
 assert.match(script,/requests\.length!==2/);
 assert.match(script,/Page\.reload/);
 assert.match(script,/previousLoaderId/);
 assert.match(script,/startupWarmup/);
 assert.match(script,/fixture-restart-warmup-passed/);
 assert.doesNotMatch(script,/--no-sandbox|localhost\.evil|disable-web-security/i);
});

test('RG-05 official manager present but no GM injection after fresh process and one fixture reload is an explicit blocker, never pass',async()=>{
 const module=await import('../../scripts/violentmonkey-restart-attestation.ts');
 const classify=(module as any).classifyOfficialViolentmonkeyRestartBlocker;
 assert.equal(typeof classify,'function','Official manager blocked result must be implemented');
 const result=classify({...input,fixture:undefined,
  missedColdStart:true,scriptStillInstalled:true,permissionStillActive:true,
  loopbackRequestsObserved:2,expectedStorageBefore:2});
 assert.equal(result.status,'fixture-restart-blocked');
 assert.equal(result.reason,'cold-start-injection-not-observed');
 assert.equal(result.productionEligible,false);
 assert.equal(result.V4,'not-configured');
 assert.equal(result.managerVerified,false);
 assert.equal(result.functionalVerified,false);
 assert.equal(Object.keys(result).includes('apis'),false);
 assert.equal(Object.keys(result).includes('productionPass'),false);
 for(const invalid of [
  {missedColdStart:false},
  {scriptStillInstalled:false},
  {permissionStillActive:false},
  {loopbackRequestsObserved:3},
  {after:{...after,pid:before.pid}},
  {appV4:'passed'},
  {observedManagers:[]},
 ]){
  assert.throws(()=>classify({...input,fixture:undefined,missedColdStart:true,
   scriptStillInstalled:true,permissionStillActive:true,loopbackRequestsObserved:2,...invalid}),
   /manager|restart|fixture|identity|incomplete|blocked|invalid/i);
 }
});
test('RG-05 smoke never turns absent manager injection into a PASS or a product V4 claim',async()=>{
 const smoke=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 assert.match(smoke,/classifyOfficialViolentmonkeyRestartBlocker/);
 assert.match(smoke,/BLOCKED RG-05/);
 assert.match(smoke,/fixture-restart-blocked/);
 assert.doesNotMatch(smoke,/restarted\.status\s*===\s*'fixture-restart-passed'\s*\|\|/);
});
