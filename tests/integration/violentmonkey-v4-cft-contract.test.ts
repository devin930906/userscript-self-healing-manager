import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {test} from 'node:test';
import vm from 'node:vm';
import {
 assertViolentmonkeyInstallReceipt,assertViolentmonkeyV4FixtureObservation,
 buildViolentmonkeyFixtureInstallExpression,buildViolentmonkeyFixturePreflightExpression,
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
 const options=smoke.indexOf("Target.createTarget',{url:optionsUrl}");
 const preflight=smoke.indexOf('const preflightReceipt=await readManagerPreflight(optionsCdp');
 const install=smoke.indexOf("const installed=await optionsCdp.send('Runtime.evaluate'");
 const inspect=smoke.indexOf('const managerReport=await inspectKnownUserscriptManagerTargets');
 assert.ok(options>=0&&preflight>options&&install>preflight&&inspect>install,
  'the official manager inventory is verified before fixture installation and manager discovery');
});

test('official manager install callback reduces parser details to a bounded privacy-safe marker',async()=>{
 const smoke=await readFile(resolve('scripts/smoke-violentmonkey-cft.mjs'),'utf8');
 const contract=await readFile(resolve('scripts/violentmonkey-v4-contract.ts'),'utf8');
 assert.match(contract,/const rawErrors=value\?\.errors;/);
 assert.match(contract,/const errors=rawErrors===null\?null:Array\.isArray\(rawErrors\)&&rawErrors\.length===0\?\[\]:\[true\];/);
 assert.match(contract,/JSON\.stringify\(\{failed:false,where:\{id:Number\.isSafeInteger\(scriptId\).*isNew,errors\}\)/);
 assert.doesNotMatch(contract,/errors:value\?\.errors/);
 assert.match(smoke,/typeof installText!=='string'/);
});

test('read-only manager preflight proves script absence from the official options-page inventory',async()=>{
 const smoke=await readFile(resolve('scripts/smoke-violentmonkey-cft.mjs'),'utf8');
 assert.match(smoke,/buildViolentmonkeyFixturePreflightExpression\(fixtureMeta\.name,fixtureMeta\.namespace\)/);
 assert.match(smoke,/await readManagerPreflight\(optionsCdp/);
 assert.match(smoke,/typeof value!=='string'\|\|value\.length>512/);
 assert.doesNotMatch(smoke,/cmd:'GetData'|cmd:'GetScript'/);
 assert.doesNotMatch(smoke,/chrome\.runtime\.sendMessage/);
});

test('official MV3 service-worker commands return only bounded fixture receipts and failure markers',async()=>{
 const run=async(expression:string,response:any,failure?:boolean)=>{
  const listeners=new Set<(event:any)=>void>();
  const sent:any[]=[];
  const endpoint:any={
   controller:null,
   addEventListener(type:string,listener:(event:any)=>void){if(type==='message')listeners.add(listener);},
   removeEventListener(type:string,listener:(event:any)=>void){if(type==='message')listeners.delete(listener);},
   ready:Promise.resolve({active:{postMessage(message:any){
    sent.push(message);
    queueMicrotask(()=>{
     const data=failure
      ?{id:message.id,err:{message:'private manager error sentinel'}}
      :{id:message.id,res:response};
     for(const listener of listeners)listener({data});
    });
   }}}),
  };
  const context=vm.createContext({navigator:{serviceWorker:endpoint},setTimeout,clearTimeout,Promise,JSON,Array});
  const result=await vm.runInContext(expression,context);
  assert.equal(sent.length,1);
  assert.ok(['GetData','ParseScript'].includes(sent[0].msg.cmd));
  if(sent[0].msg.cmd==='GetData'){
   assert.equal(Object.keys(sent[0].msg.data).join(','),'sizes');
   assert.equal(sent[0].msg.data.sizes,false);
  }else{
   assert.equal(Object.keys(sent[0].msg.data).sort().join(','),'bumpDate,code,config,custom,isNew,message');
   assert.match(sent[0].msg.data.code,/USSHM Isolated Violentmonkey V4 Fixture/);
  }
  assert.ok(Number.isSafeInteger(sent[0].id));
  return result;
 };
 const preflight=buildViolentmonkeyFixturePreflightExpression(
  'USSHM Isolated Violentmonkey V4 Fixture','https://usshm.invalid/isolated-fixture');
 const absent=await run(preflight,{scripts:[{meta:{name:'unrelated'},code:'private source sentinel'}]});
 assert.equal(absent,JSON.stringify({found:false}));
 assert.doesNotMatch(absent,/private source sentinel/);
 const present=await run(preflight,{scripts:[{
  meta:{name:'USSHM Isolated Violentmonkey V4 Fixture',namespace:'https://usshm.invalid/isolated-fixture'},
  code:'private source sentinel',
 }]});
 assert.equal(present,JSON.stringify({found:true}));
 const failed=await run(preflight,{},true);
 assert.equal(failed,JSON.stringify({failed:true}));
 assert.doesNotMatch(failed,/private manager error sentinel/);

 const fixtureSource='// @name USSHM Isolated Violentmonkey V4 Fixture\n// @namespace https://usshm.invalid/isolated-fixture\nprivate install source sentinel';
 const install=buildViolentmonkeyFixtureInstallExpression(fixtureSource);
 const installed=await run(install,{where:{id:7},isNew:true,errors:null});
 assert.deepEqual(JSON.parse(installed),{failed:false,where:{id:7},isNew:true,errors:null});
 assert.doesNotMatch(installed,/private install source sentinel/);
 const parseFailed=await run(install,{where:{id:7},errors:[{message:'private parser error sentinel'}]});
 assert.deepEqual(JSON.parse(parseFailed),{failed:false,where:{id:7},errors:[true]});
 assert.doesNotMatch(parseFailed,/private parser error sentinel/);
 assert.throws(()=>buildViolentmonkeyFixturePreflightExpression('x'.repeat(161),'fixed namespace'),/fixed/i);
 assert.throws(()=>buildViolentmonkeyFixtureInstallExpression('untrusted source'),/fixed/i);
});


test('official manager download is pinned, bounded and never bypasses the official GM gate',async()=>{
 const workflow=await readFile(resolve('.github/workflows/dev-ci.yml'),'utf8');
 const helper=await readFile(resolve('scripts/download-violentmonkey-release.mjs'),'utf8');
 const fetchStep=workflow.split('- name: Fetch pinned official Violentmonkey 2.49.0 MV3 release for isolated integration')[1]
  ?.split('- name: Real Violentmonkey 2.49.0 GM API integration')[0];
 assert.ok(fetchStep,'official manager download job must remain mandatory');
 assert.match(fetchStep,/node scripts\/download-violentmonkey-release\.mjs \$archive/);
 assert.match(fetchStep,/if \(\$LASTEXITCODE -ne 0\) \{ throw 'Verified Violentmonkey download failed' \}/);
 assert.match(fetchStep,/Pinned official Violentmonkey archive SHA-256 mismatch/);
 assert.ok(fetchStep.indexOf('Pinned official Violentmonkey archive SHA-256 mismatch')<
  fetchStep.indexOf('Expand-Archive'),'PowerShell must recheck pinned SHA before extraction');
 assert.match(helper,/for\(let attempt=1;attempt<=3;attempt\+\+\)/);
 assert.match(helper,/RETRYABLE_HTTP=new Set\(\[429,500,502,503,504\]\)/);
 assert.match(helper,/attempt===3\)throw error;/,'exhausted retry must fail closed');
 assert.ok(helper.indexOf('actual!==expectedSha256')<helper.indexOf('copyFile('),
  'helper may expose final archive only after streaming SHA-256 succeeded');
 assert.match(helper,/COPYFILE_EXCL/,'never replace a pre-existing runner asset');
 assert.doesNotMatch(fetchStep,/continue-on-error:\s*true|if:\s*false|\|\| true/i);
 assert.match(workflow,/node --experimental-strip-types scripts\/smoke-violentmonkey-cft\.mjs/,
  'manager GM V4 release gate remains mandatory after a valid download');
});
