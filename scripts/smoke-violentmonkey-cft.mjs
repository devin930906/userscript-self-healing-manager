/**
 * TEST-ONLY integration with the pinned official Violentmonkey MV3 release.
 * Runs one fixed userscript in a disposable CFT profile on a loopback page.
 * The result is fixture evidence only; product V4 remains not-configured.
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {access,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join,resolve,sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {
 assertChromeDebuggerPortFree,buildChromeLaunchArgs,getVerifiedChromeStatus,getChromeStatus,
} from '../packages/cdp-client/src/index.ts';
import {confirmPageIdentity} from '../packages/cdp-client/src/page-identity.ts';
import {waitForPinnedFixtureFrame} from './violentmonkey-frame-ready.ts';
import {assertOfficialViolentmonkeyProcessRestart} from './violentmonkey-restart-attestation.ts';
import {inspectKnownUserscriptManagerTargets} from '../packages/cdp-client/src/manager-targets.ts';
import {
 assertViolentmonkeyInstallReceipt,assertViolentmonkeyV4FixtureObservation,extensionIdFromChromePublicKey,
 buildViolentmonkeyFixtureInstallExpression,buildViolentmonkeyFixturePreflightExpression,
 buildViolentmonkeyUserScriptsProbeExpression,enableViolentmonkeyUserScriptsAccess,
 readViolentmonkeyFixtureObservation,
 waitForVerifiedViolentmonkeyInjector,
 scopeViolentmonkeyFixtureToUrl,
 VIOLENTMONKEY_CFT_RELEASE,
} from './violentmonkey-v4-contract.ts';

const extensionId=VIOLENTMONKEY_CFT_RELEASE.extensionId;
const resultAttribute='data-usshm-vm-v4-result';
const expectedProduct=/^(?:Chrome|HeadlessChrome)\/155\./;
if(process.platform!=='win32'||process.env.USSHM_SMOKE_EXPECT_CHROME_MAJOR!=='155')
 throw new Error('This official manager fixture is restricted to the isolated Windows CFT 155 job');
const executable=process.env.CHROME_PATH;
if(!executable||!executable.includes('USSHM-ChromeForTesting-155')||!/chrome\.exe$/i.test(executable))
 throw new Error('Refusing to launch an unpinned or non-CFT Chrome executable');
await access(executable);
const extensionRoot=process.env.USSHM_VIOLENTMONKEY_EXTENSION;
const runnerTemp=process.env.RUNNER_TEMP;
if(!extensionRoot||!runnerTemp||!basename(extensionRoot).toLowerCase().startsWith('usshm-violentmonkey-2.49.0'))
 throw new Error('Pinned Violentmonkey test extension directory is not configured');
const absoluteExtensionRoot=resolve(extensionRoot);
const absoluteRunnerTemp=resolve(runnerTemp);
if(!absoluteExtensionRoot.toLowerCase().startsWith((absoluteRunnerTemp+sep).toLowerCase()))
 throw new Error('Refusing to modify an extension outside the disposable runner temp directory');
if(extensionIdFromChromePublicKey(VIOLENTMONKEY_CFT_RELEASE.publicKey)!==extensionId)
 throw new Error('Pinned Violentmonkey public key does not match the official extension ID');
const manifestPath=join(absoluteExtensionRoot,'manifest.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
if(manifest.version!==VIOLENTMONKEY_CFT_RELEASE.version||manifest.manifest_version!==3||
   (manifest.key&&manifest.key!==VIOLENTMONKEY_CFT_RELEASE.publicKey))
 throw new Error('Unexpected Violentmonkey release manifest');
// Chrome derives unpacked extension IDs from this official public key. It is
// copied from the v2.49.0 Chrome Web Store CRX; the pinned release ZIP's JS
// assets remain unchanged. This mutation exists only in Runner.Temp for CFT.
manifest.key=VIOLENTMONKEY_CFT_RELEASE.publicKey;
await writeFile(manifestPath,JSON.stringify(manifest)+'\n',{flag:'w'});

const userScript=`// ==UserScript==
// @name USSHM Isolated Violentmonkey V4 Fixture
// @namespace https://usshm.invalid/isolated-fixture
// @match http://127.0.0.1/*
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_registerMenuCommand
// @grant GM_xmlhttpRequest
// @connect 127.0.0.1
// @run-at document-idle
// ==/UserScript==
(async()=>{
 if(location.protocol!=='http:'||location.hostname!=='127.0.0.1'||location.pathname!=='/fixture')return;
 let stage='started';
 const mark=value=>document.documentElement.setAttribute('data-usshm-vm-v4-stage',value);
 mark(stage);
 try{
 const key='usshm-vm-v4-fixture-counter';
 mark(stage='storage-read');
 const before=await GM_getValue(key,0);
 const after=Number.isSafeInteger(before)?before+1:-100;
 await GM_setValue(key,after);
 mark(stage='storage-readback');
 const readback=await GM_getValue(key,-2);
 mark(stage='menu-registration');
 const menuCommandId=GM_registerMenuCommand('USSHM isolated manager fixture',()=>{
  document.documentElement.setAttribute('data-usshm-vm-v4-menu','called');
 },{id:'usshm-v4-fixture-menu'});
 const finish=(requestStatus,requestBody)=>{
  mark('completed');
  document.documentElement.setAttribute('${resultAttribute}',JSON.stringify({
   storageBefore:before,storageAfter:after,storageReadback:readback,
   menuCommandId,requestStatus,requestBody,
  }));
 };
 mark(stage='gm-request');
 GM_xmlhttpRequest({
  method:'GET',url:location.origin+'/gm-request',timeout:5000,
  onload:response=>finish(response.status,response.responseText),
  onerror:()=>finish(-1,''),
  ontimeout:()=>finish(-2,''),
 });
 }catch{mark('failed-'+stage);}
})();
`;
const fixtureMeta={
 name:'USSHM Isolated Violentmonkey V4 Fixture',
 namespace:'https://usshm.invalid/isolated-fixture',
};
async function openCdp(endpoint){
 const socket=new WebSocket(endpoint);
 const pending=new Map();
 let sequence=0,closed=false;
 let openedResolve,openedReject;
 const opened=new Promise((resolve,reject)=>{openedResolve=resolve;openedReject=reject;});
 socket.addEventListener('open',()=>openedResolve());
 socket.addEventListener('error',()=>openedReject(new Error('CDP WebSocket connection failed')));
 socket.addEventListener('message',event=>{
  let response;
  try{response=JSON.parse(typeof event.data==='string'?event.data:String(event.data));}
  catch{return;}
  const task=pending.get(response.id);
  if(!task)return;
  pending.delete(response.id);clearTimeout(task.timer);
  if(response.error)task.reject(new Error('CDP command failed'));
  else task.resolve(response.result??{});
 });
 socket.addEventListener('close',()=>{
  closed=true;openedReject(new Error('CDP WebSocket closed'));
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('CDP WebSocket closed'));}
  pending.clear();
 });
 await opened;
 return {
  send(method,params={}){
   if(closed)throw new Error('CDP WebSocket is closed');
   const id=++sequence;
   return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP command timed out'));},5000);
    pending.set(id,{resolve,reject,timer});
    try{socket.send(JSON.stringify({id,method,params}));}
    catch{clearTimeout(timer);pending.delete(id);reject(new Error('CDP command could not be sent'));}
   });
  },
  close(){try{socket.close();}catch{}}
 };
}

async function waitForPage(targetId,expectedUrl,hasExited){
 let lastStatus;
 for(let attempt=0;attempt<80;attempt++){
  if(hasExited())throw new Error('Isolated CFT exited before the requested fixture page loaded');
  try{
   const status=await getChromeStatus({port:9223});
   const page=status.pages.find(item=>item.id===targetId&&item.url===expectedUrl&&item.webSocketDebuggerUrl);
   if(page)return page;
  }catch(error){lastStatus=error instanceof Error?error.message:'';}
  await delay(250);
 }
 throw new Error('Isolated CFT did not expose the pinned fixture page'+(lastStatus?': '+lastStatus:''));
}

async function readManagerPreflight(cdp,hasExited){
 if(hasExited())throw new Error('Isolated CFT exited during the bounded manager preflight');
 const expression=buildViolentmonkeyFixturePreflightExpression(fixtureMeta.name,fixtureMeta.namespace);
 let value;
 try{
  const answer=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  value=answer.result?.value;
 }catch{throw new Error('Violentmonkey bounded read-only preflight request failed');}
 if(typeof value!=='string'||value.length>512)
  throw new Error('Violentmonkey did not return a bounded read-only fixture preflight');
 let receipt;
 try{receipt=JSON.parse(value);}catch{throw new Error('Violentmonkey read-only preflight returned an invalid fixed receipt');}
 if(receipt?.failed===true)throw new Error('Violentmonkey read-only preflight returned a fixed failure marker');
 if(typeof receipt?.found!=='boolean')
  throw new Error('Violentmonkey read-only preflight returned an invalid fixed receipt');
 return {found:receipt.found};
}

const profile=await mkdtemp(join(tmpdir(),'usshm-vm-v4-profile-'));
const requests=[];
const server=createServer((request,response)=>{
 if(request.method==='GET'&&request.url==='/fixture'){
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  response.end('<!doctype html><html><head><title>USSHM VM fixture</title></head><body><main id="usshm-vm-fixture">Local synthetic manager fixture</main></body></html>');
  return;
 }
 if(request.method==='GET'&&request.url==='/gm-request'){
  requests.push({method:request.method,url:request.url});
  response.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
  response.end('USSHM_GM_REQUEST_OK');
  return;
 }
 response.writeHead(404,{'content-type':'text/plain; charset=utf-8'}).end('not found');
});
let listening=false,chrome,exited=false,spawnFailure;
let browserCdp,optionsCdp,pageCdp,extensionsCdp;
try{
 await assertChromeDebuggerPortFree(9223);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 listening=true;
 const address=server.address();
 if(!address||typeof address==='string')throw new Error('Loopback fixture failed to bind');
 const fixtureUrl=`http://127.0.0.1:${address.port}/fixture`;
 const optionsUrl=`chrome-extension://${extensionId}/options/index.html#settings`;
 const pinnedLaunchArgs=[
  ...buildChromeLaunchArgs(9223,{isolatedProfileDir:profile}),
  '--headless=new','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-sync','--disable-gpu',
  // A dead local proxy blocks non-loopback HTTP(S); Chrome bypasses proxies
  // for loopback, which is the only network target granted by the fixture.
  '--proxy-server=http://127.0.0.1:9',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
  '--disable-extensions-except='+absoluteExtensionRoot,
  '--load-extension='+absoluteExtensionRoot,
  '--new-window','about:blank',
 ];
 chrome=spawn(executable,pinnedLaunchArgs,{windowsHide:true,stdio:['ignore','ignore','ignore']});
 chrome.on('error',error=>{spawnFailure=error;exited=true;});
 chrome.on('exit',()=>{exited=true;});
 let status;
 for(let attempt=0;attempt<100;attempt++){
  if(spawnFailure)throw new Error('Pinned CFT process could not be started');
  if(exited)throw new Error('Pinned CFT exited before CDP verification');
  try{
   status=await getVerifiedChromeStatus({port:9223});
   if(expectedProduct.test(status.browser))break;
   throw new Error('Unexpected Chrome version');
  }catch(error){
   if(error instanceof Error&&error.message==='Unexpected Chrome version')throw error;
  }
  await delay(300);
 }
 if(!status||!expectedProduct.test(status.browser))throw new Error('Pinned Chrome 155 CDP handshake was not verified');
 browserCdp=await openCdp(status.browserSocket);
 const createdOptions=await browserCdp.send('Target.createTarget',{url:optionsUrl});
 if(typeof createdOptions.targetId!=='string'||!createdOptions.targetId)
  throw new Error('Violentmonkey options page target could not be created');
 const optionsPage=await waitForPage(createdOptions.targetId,optionsUrl,()=>exited);
 optionsCdp=await openCdp(optionsPage.webSocketDebuggerUrl);
 await optionsCdp.send('Runtime.enable');
 // Chrome 138+ gates chrome.userScripts behind the extension-specific Allow
 // User Scripts setting. Installing a script does not grant that permission.
 // This changes only the pinned unpacked extension in THIS disposable profile.
 const probeAccess=async()=>{
  const answer=await optionsCdp.send('Runtime.evaluate',{
   expression:buildViolentmonkeyUserScriptsProbeExpression(),awaitPromise:true,returnByValue:true,
  });
  return answer.result?.value===JSON.stringify({available:true});
 };
 const initiallyAvailable=await probeAccess();
 console.log('Isolated Violentmonkey userScripts capability before setup: '+initiallyAvailable);
 if(!initiallyAvailable){
  const extensionsUrl='chrome://extensions/';
  const createdExtensions=await browserCdp.send('Target.createTarget',{url:extensionsUrl});
  if(typeof createdExtensions.targetId!=='string'||!createdExtensions.targetId)
   throw new Error('Isolated Chrome extension settings target could not be created');
  const extensionsPage=await waitForPage(createdExtensions.targetId,extensionsUrl,()=>exited);
  extensionsCdp=await openCdp(extensionsPage.webSocketDebuggerUrl);
  await enableViolentmonkeyUserScriptsAccess(extensionsCdp.send);
  extensionsCdp.close();extensionsCdp=undefined;
  await browserCdp.send('Target.closeTarget',{targetId:createdExtensions.targetId});
 }
 if(!await probeAccess())throw new Error('Pinned manager userScripts API remains unavailable after isolated permission setup');
 console.log('PASS isolated pinned manager userScripts capability; no daily browser profile was accessed.');
 // VM's onInstalled/options initialization may have run before the permission
 // grant. Await its own initializer now, before navigating to document_start.
 await waitForVerifiedViolentmonkeyInjector({
  send:(method,params)=>optionsCdp.send(method,params),
  hasExited:()=>exited,
  onStatus:stage=>console.log('Isolated official Violentmonkey readiness: '+stage),
 });
 console.log('PASS isolated official Violentmonkey base injector registration.');
 const preflightReceipt=await readManagerPreflight(optionsCdp,()=>exited);
 if(preflightReceipt.found!==false)
  throw new Error('Fixed synthetic userscript already existed or could not be checked in the disposable profile');
 // VM 2.49.0 compares authority including port. A portless @match cannot
 // select the ephemeral server's URL; pin only this exact loopback fixture.
 const scopedUserScript=scopeViolentmonkeyFixtureToUrl(userScript,fixtureUrl);
 const installExpression=buildViolentmonkeyFixtureInstallExpression(scopedUserScript);
 const installed=await optionsCdp.send('Runtime.evaluate',{
  expression:installExpression,awaitPromise:true,returnByValue:true,
 });
 const installText=installed.result?.value;
 if(typeof installText!=='string')
  throw new Error('Violentmonkey did not return a bounded fixture-install receipt: missing-result');
 if(installText.length>512)
  throw new Error('Violentmonkey did not return a bounded fixture-install receipt: oversized');
 const installReceipt=JSON.parse(installText);
 if(installReceipt.failed)
  throw new Error('Violentmonkey rejected the fixed synthetic userscript fixture');
 assertViolentmonkeyInstallReceipt(installReceipt,preflightReceipt.found===false);
 // ParseScript exercises the real official manager and wakes its MV3 worker;
 // the app's read-only target inventory is intentionally passive and may not
 // report a sleeping worker before this bounded fixture interaction.
 const managerReport=await inspectKnownUserscriptManagerTargets({
  approved:true,browserEndpoint:status.browserSocket,expectedProduct:status.browser,port:9223,
 });
 assert.ok(managerReport.observed.includes('violentmonkey'));
 assert.equal(managerReport.V4,'not-configured');
 assert.equal(managerReport.managerVerified,false);
 const createdFixture=await browserCdp.send('Target.createTarget',{url:fixtureUrl});
 if(typeof createdFixture.targetId!=='string'||!createdFixture.targetId)
  throw new Error('Loopback GM fixture page target could not be created');
 const fixturePage=await waitForPage(createdFixture.targetId,fixtureUrl,()=>exited);
 const identity=await waitForPinnedFixtureFrame({
  expectedUrl:fixtureUrl,
  inspect:()=>confirmPageIdentity(fixturePage),
  hasExited:()=>exited,
  pause:()=>delay(250),
 });
 assert.equal(identity.confirmedUrl,fixtureUrl);
 if(!identity.frameId||!identity.loaderId)throw new Error('Loopback fixture document identity was not pinned');
 pageCdp=await openCdp(fixturePage.webSocketDebuggerUrl);
 await pageCdp.send('Runtime.enable');
 await pageCdp.send('Page.enable');
 console.log('RG-05 fixed stage: first-document');
 const first=await readViolentmonkeyFixtureObservation({
  send:pageCdp.send,frameId:identity.frameId,url:fixtureUrl,hasExited:()=>exited,
 });
 const firstReceipt=assertViolentmonkeyV4FixtureObservation({
  chromeProduct:status.browser,managerVersion:manifest.version,
  managerExtensionId:extensionId,observedManagers:managerReport.observed,
  appV4:managerReport.V4,appManagerVerified:managerReport.managerVerified,
  fixture:first,
 },0);
 console.log('RG-05 fixed stage: first-documented');
 const beforeReload=await pageCdp.send('Page.getFrameTree');
 const previousLoaderId=beforeReload.frameTree?.frame?.loaderId;
 if(typeof previousLoaderId!=='string'||!previousLoaderId)
  throw new Error('Pre-reload fixture document identity is missing');
 await pageCdp.send('Page.reload',{ignoreCache:true});
 console.log('RG-05 fixed stage: page-reload');
 const second=await readViolentmonkeyFixtureObservation({
  send:pageCdp.send,frameId:identity.frameId,url:fixtureUrl,previousLoaderId,hasExited:()=>exited,
 });
 const secondReceipt=assertViolentmonkeyV4FixtureObservation({
  chromeProduct:status.browser,managerVersion:manifest.version,
  managerExtensionId:extensionId,observedManagers:managerReport.observed,
  appV4:managerReport.V4,appManagerVerified:managerReport.managerVerified,
  fixture:second,
 },1);
 assert.equal(requests.length,2,'only the two fixed loopback GM request callbacks are allowed');
 assert.ok(requests.every(item=>item.method==='GET'&&item.url==='/gm-request'));
 assert.deepEqual(secondReceipt.apis,firstReceipt.apis);

 // RG-05: Page.reload never proves storage survives actual browser restart.
 console.log('RG-05 fixed stage: page-reload-documented');
 const previousChromePid=chrome.pid;
 const previousBrowserSocket=status.browserSocket;
 const beforeRestartIdentity=await confirmPageIdentity(fixturePage);
 if(!Number.isSafeInteger(previousChromePid)||previousChromePid<2||
    !previousBrowserSocket||beforeRestartIdentity.targetId!==fixturePage.id||
    beforeRestartIdentity.confirmedUrl!==fixtureUrl||
    !beforeRestartIdentity.frameId||!beforeRestartIdentity.loaderId)
  throw new Error('Pinned isolated Chrome restart baseline identity unavailable');
 pageCdp.close();pageCdp=undefined;
 optionsCdp.close();optionsCdp=undefined;
 // Gracefully close only the spawned pinned CI process so GM storage flushes.
 // Browser.close may terminate its WebSocket before returning its response.
 try{await browserCdp.send('Browser.close');}catch{}
 browserCdp.close();browserCdp=undefined;
 for(let i=0;i<60&&!exited;i++)await delay(250);
 if(!exited)throw new Error('Original pinned isolated Chrome did not exit');
 let released=false;
 for(let i=0;i<40;i++){
  try{await assertChromeDebuggerPortFree(9223);released=true;break;}
  catch{await delay(150);}
 }
 if(!released)throw new Error('Pinned Chrome debugger port remained occupied after exit');
 // Reuse the exact same disposable profile. No user profile or manager install.
 exited=false;spawnFailure=undefined;
 chrome=spawn(executable,pinnedLaunchArgs,{windowsHide:true,stdio:['ignore','ignore','ignore']});
 chrome.on('error',error=>{spawnFailure=error;exited=true;});
 chrome.on('exit',()=>{exited=true;});
 let freshStatus;
 for(let i=0;i<100;i++){
  if(spawnFailure||exited)throw new Error('Restarted pinned Chrome exited before GM verification');
  try{
   freshStatus=await getVerifiedChromeStatus({port:9223});
   if(expectedProduct.test(freshStatus.browser))break;
   throw new Error('Restarted Chrome product mismatch');
  }catch(error){
   if(error instanceof Error&&error.message==='Restarted Chrome product mismatch')throw error;
  }
  await delay(300);
 }
 if(!freshStatus||!expectedProduct.test(freshStatus.browser)||
    !freshStatus.browserSocket||freshStatus.browserSocket===previousBrowserSocket||
    chrome.pid===previousChromePid)
  throw new Error('A distinct verified Chrome browser process was not observed');
 status=freshStatus;
 browserCdp=await openCdp(status.browserSocket);
 const newOptionsTarget=await browserCdp.send('Target.createTarget',{url:optionsUrl});
 if(typeof newOptionsTarget.targetId!=='string'||!newOptionsTarget.targetId)
  throw new Error('Reopened manager options page unavailable after real process restart');
 const restartedOptionsPage=await waitForPage(newOptionsTarget.targetId,optionsUrl,()=>exited);
 optionsCdp=await openCdp(restartedOptionsPage.webSocketDebuggerUrl);
 await optionsCdp.send('Runtime.enable');
 // A genuine restarted manager must retain both permission and installed
 // script. Do not grant again, reinitialize profile settings or reinstall.
 const permission=await optionsCdp.send('Runtime.evaluate',{
  expression:buildViolentmonkeyUserScriptsProbeExpression(),awaitPromise:true,returnByValue:true,
 });
 if(permission.result?.value!==JSON.stringify({available:true}))
  throw new Error('Pinned manager userScripts permission not retained across process restart');
 await waitForVerifiedViolentmonkeyInjector({
  send:(method,params)=>optionsCdp.send(method,params),
  hasExited:()=>exited,
 });
 const retainedScript=await readManagerPreflight(optionsCdp,()=>exited);
 if(retainedScript.found!==true)
  throw new Error('Pinned official Violentmonkey script not retained across process restart');
 const resumedManagers=await inspectKnownUserscriptManagerTargets({
  approved:true,browserEndpoint:status.browserSocket,expectedProduct:status.browser,port:9223,
 });
 if(!resumedManagers.observed.includes('violentmonkey')||
    resumedManagers.V4!=='not-configured'||resumedManagers.managerVerified!==false)
  throw new Error('Official manager target missing after process restart');
 const createdRestartFixture=await browserCdp.send('Target.createTarget',{url:fixtureUrl});
 if(typeof createdRestartFixture.targetId!=='string'||!createdRestartFixture.targetId)
  throw new Error('Restarted Chrome could not create isolated fixture');
 const restartedFixturePage=await waitForPage(createdRestartFixture.targetId,fixtureUrl,()=>exited);
 const afterRestartIdentity=await waitForPinnedFixtureFrame({
  expectedUrl:fixtureUrl,inspect:()=>confirmPageIdentity(restartedFixturePage),
  hasExited:()=>exited,pause:()=>delay(250),
 });
 pageCdp=await openCdp(restartedFixturePage.webSocketDebuggerUrl);
 await pageCdp.send('Runtime.enable');
 await pageCdp.send('Page.enable');
 console.log('RG-05 fixed stage: process-restart');
 const third=await readViolentmonkeyFixtureObservation({
  send:pageCdp.send,frameId:afterRestartIdentity.frameId,url:fixtureUrl,hasExited:()=>exited,
 });
 assert.equal(requests.length,3,'cross-process manager test must observe exactly one additional GM request');
 assert.ok(requests.every(item=>item.method==='GET'&&item.url==='/gm-request'));
 const restarted=assertOfficialViolentmonkeyProcessRestart({
  before:{pid:previousChromePid,browserSocket:previousBrowserSocket,
   frameId:beforeRestartIdentity.frameId,loaderId:beforeRestartIdentity.loaderId},
  after:{pid:chrome.pid,browserSocket:status.browserSocket,
   frameId:afterRestartIdentity.frameId,loaderId:afterRestartIdentity.loaderId},
  chromeProduct:status.browser,managerVersion:manifest.version,managerExtensionId:extensionId,
  observedManagers:resumedManagers.observed,appV4:resumedManagers.V4,
  appManagerVerified:resumedManagers.managerVerified,fixture:third,
  loopbackRequestsObserved:requests.length,expectedStorageBefore:2,
 });
 assert.equal(restarted.status,'fixture-restart-passed');
 console.log('PASS official Violentmonkey 2.49.0 isolated Chrome PROCESS restart: GM persisted 0->1->2->3, permission/script retained, three loopback requests. Product V4 not-configured.');

 console.log('PASS isolated official Violentmonkey 2.49.0: GM storage persisted across reload, menu command registered and GM_xmlhttpRequest reached loopback. Product V4 remains not-configured; Tampermonkey is not covered.');
}catch(error){
 console.error('FAIL isolated Violentmonkey fixture:',error instanceof Error?error.message:'unknown');
 process.exitCode=1;
}finally{
 pageCdp?.close();optionsCdp?.close();extensionsCdp?.close();browserCdp?.close();
 if(chrome?.pid)spawnSync('taskkill',['/PID',String(chrome.pid),'/T','/F'],{stdio:'ignore',timeout:15000});
 if(listening)await new Promise(resolve=>server.close(()=>resolve()));
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250}).catch(()=>{});
 // Only remove the exact disposable extraction owned by this workflow step.
 if(absoluteExtensionRoot.toLowerCase().startsWith((absoluteRunnerTemp+sep).toLowerCase())&&
    basename(absoluteExtensionRoot).toLowerCase().startsWith('usshm-violentmonkey-2.49.0'))
  await rm(absoluteExtensionRoot,{recursive:true,force:true,maxRetries:5,retryDelay:250}).catch(()=>{});
}
