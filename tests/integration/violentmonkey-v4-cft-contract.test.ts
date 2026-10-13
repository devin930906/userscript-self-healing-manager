import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {
 assertViolentmonkeyInstallReceipt,assertViolentmonkeyV4FixtureObservation,
 extensionIdFromChromePublicKey,VIOLENTMONKEY_CFT_RELEASE,
} from '../../scripts/violentmonkey-v4-contract.ts';

const observation=(before=0)=>({
 chromeProduct:'Chrome/155.0.8059.39',
 managerVersion:'2.49.0',
 managerExtensionId:'jinjaccalgkegednnccohejagnlnfdag',
 observedManagers:['violentmonkey'],
 appV4:'not-configured',
 appManagerVerified:false,
 fixture:{
  storageBefore:before,storageAfter:before+1,storageReadback:before+1,
  menuCommandId:'usshm-v4-fixture-menu',requestStatus:200,
  requestBody:'USSHM_GM_REQUEST_OK',
 },
});

test('isolated Violentmonkey fixture requires its exact manager identity and all declared GM APIs',()=>{
 assert.equal(extensionIdFromChromePublicKey(VIOLENTMONKEY_CFT_RELEASE.publicKey),
  VIOLENTMONKEY_CFT_RELEASE.extensionId);
 for(const before of [0,1]){
  const result=assertViolentmonkeyV4FixtureObservation(observation(before),before);
  assert.equal(result.status,'fixture-passed');
  assert.deepEqual(result.apis,['GM_getValue','GM_setValue','GM_registerMenuCommand','GM_xmlhttpRequest']);
  assert.equal(result.V4,'not-configured');
  assert.equal(result.managerVerified,false);
  assert.equal(result.productionEligible,false);
 }
});

test('synthetic extension targets, missing GM APIs and a claimed V4 pass cannot satisfy the official-manager fixture',()=>{
 const mutations=[
  (x:any)=>{x.managerVersion='2.48.9';},
  (x:any)=>{x.managerExtensionId='abcdefghijklmnopabcdefghijklmnop';},
  (x:any)=>{x.observedManagers=[];},
  (x:any)=>{x.appV4='passed';},
  (x:any)=>{x.appManagerVerified=true;},
  (x:any)=>{x.fixture.storageReadback=99;},
  (x:any)=>{x.fixture.menuCommandId='';},
  (x:any)=>{x.fixture.requestStatus=0;},
  (x:any)=>{x.fixture.requestBody='';},
 ];
 for(const mutate of mutations){
  const forged=observation();mutate(forged);
  assert.throws(()=>assertViolentmonkeyV4FixtureObservation(forged,0),/incomplete|inconsistent/i);
 }
});

test('the manager fixture is restricted to the pinned Chrome 155 runtime',()=>{
 for(const chromeProduct of ['Chrome/154.0.0.1','Firefox/155','Chromium/156.0.0.1']){
  const bad={...observation(),chromeProduct};
  assert.throws(()=>assertViolentmonkeyV4FixtureObservation(bad,0),/incomplete|inconsistent/i);
 }
});

test('official Violentmonkey 2.49.0 install receipts accept its null errors field and reject parser failures',()=>{
 const accepted=assertViolentmonkeyInstallReceipt({
  where:{id:1},errors:null,
 },true);
 assert.equal(accepted.scriptId,1);
 assert.equal(assertViolentmonkeyInstallReceipt({
  where:{id:2},isNew:true,errors:[],
 },true).scriptId,2);
 assert.throws(()=>assertViolentmonkeyInstallReceipt({
  where:{id:1},errors:[{message:'parse failed'}],
 },true),/receipt|rejected/i);
 assert.throws(()=>assertViolentmonkeyInstallReceipt({
  where:{id:1},isNew:false,errors:null,
 },true),/receipt|rejected/i);
 assert.throws(()=>assertViolentmonkeyInstallReceipt({
  where:{id:'1'},errors:null,
 },true),/receipt|rejected/i);
});

test('install receipt failures expose only a fixed structural reason for safe CI diagnosis',()=>{
 assert.throws(()=>assertViolentmonkeyInstallReceipt(null,true),/receipt rejected: envelope/i);
 assert.throws(()=>assertViolentmonkeyInstallReceipt({
  where:null,errors:null,
 },true),/receipt rejected: script-location/i);
 assert.throws(()=>assertViolentmonkeyInstallReceipt({
  where:{id:1},isNew:false,errors:null,
 },true),/receipt rejected: not-new-script/i);
 assert.throws(()=>assertViolentmonkeyInstallReceipt({
  where:{id:1},errors:[{message:'private or parser text'}],
 },true),/receipt rejected: parser-errors/i);
 assert.throws(()=>assertViolentmonkeyInstallReceipt({
  where:{id:'private value'},errors:null,
 },true),/receipt rejected: script-id/i);
 assert.throws(()=>assertViolentmonkeyInstallReceipt({
  where:{id:1},errors:null,
 },false),/receipt rejected: preexisting-script/i);
});

test('official manager workflow stays pinned, loopback-only and outside installer distribution jobs',async()=>{
 const workflow=await readFile(resolve('.github/workflows/dev-ci.yml'),'utf8');
 const smoke=await readFile(resolve('scripts/smoke-violentmonkey-cft.mjs'),'utf8');
 assert.match(workflow,/violentmonkey\/violentmonkey\/releases\/download\/v2\.49\.0\/Violentmonkey-mv3-v2\.49\.0\.zip/);
 assert.match(workflow,new RegExp(VIOLENTMONKEY_CFT_RELEASE.archiveSha256));
 assert.match(workflow,/runs-on:\s*windows-latest/);
 assert.match(workflow,/USSHM_SMOKE_EXPECT_CHROME_MAJOR:\s*'155'/);
 assert.doesNotMatch(workflow,/dist:win|electron-builder|upload-artifact/i);
 const source=smoke.match(/const userScript=`([\s\S]*?)`;/)?.[1];
 assert.ok(source,'fixed synthetic userscript source must be present');
 const metadata=source.split(/\r?\n/).filter(line=>line.startsWith('// @'));
 assert.deepEqual(metadata,[
  '// @name USSHM Isolated Violentmonkey V4 Fixture',
  '// @namespace https://usshm.invalid/isolated-fixture',
  '// @match http://127.0.0.1/*',
  '// @grant GM_getValue',
  '// @grant GM_setValue',
  '// @grant GM_registerMenuCommand',
  '// @grant GM_xmlhttpRequest',
  '// @connect 127.0.0.1',
  '// @run-at document-idle',
 ]);
 const windowsMetadata=source.replace(/\r\n?/g,'\n').replace(/\n/g,'\r\n')
  .split(/\r?\n/).filter(line=>line.startsWith('// @'));
 assert.deepEqual(windowsMetadata,metadata,'Windows checkout line endings must not change userscript metadata');
 assert.doesNotMatch(smoke,/--no-sandbox/i);
 assert.match(smoke,/--proxy-server=http:\/\/127\.0\.0\.1:9/);
});

test('manager discovery follows a fixed-script install whose preflight proves the script was absent',async()=>{
 const smoke=await readFile(resolve('scripts/smoke-violentmonkey-cft.mjs'),'utf8');
 const preflight=smoke.indexOf("const preflight=await optionsCdp.send('Runtime.evaluate'");
 const install=smoke.indexOf("const installed=await optionsCdp.send('Runtime.evaluate'");
 const inspect=smoke.indexOf('const managerReport=await inspectKnownUserscriptManagerTargets');
 assert.ok(preflight>=0&&install>preflight&&inspect>install,
  'manager discovery follows an absent-script preflight and installation that starts the worker');
});
