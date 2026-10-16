/**
 * TEST-ONLY: Real Chrome for Testing 155 unpacked MV3 extension smoke.
 * Chrome branded 137+ does not accept --load-extension; do not run against
 * an owner's Chrome or normal profile. This tests an isolated synthetic
 * extension injection mechanism, NOT Tampermonkey, GM_* or V4 certification.
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {access,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {
 assertChromeDebuggerPortFree,buildChromeLaunchArgs,getVerifiedChromeStatus,
} from '../packages/cdp-client/src/index.ts';
import {confirmPageIdentity} from '../packages/cdp-client/src/page-identity.ts';
import {probePageLocators} from '../packages/cdp-client/src/locator-probe.ts';

if(process.platform!=='win32'||process.env.USSHM_SMOKE_EXPECT_CHROME_MAJOR!=='155')
 throw new Error('This fixture is permitted only on the isolated Windows CFT 155 job');
const executable=process.env.CHROME_PATH;
if(!executable||!executable.includes('USSHM-ChromeForTesting-155')||
   !/chrome\.exe$/i.test(executable))
 throw new Error('Refusing to launch an unpinned or non-CFT Chrome executable');
await access(executable);

async function requestBrowserClose(browserSocket){
 const socket=new WebSocket(browserSocket);
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Synthetic CFT browser close socket timed out')),5000);
  socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
  socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Synthetic CFT browser close socket failed'));},{once:true});
 });
 socket.send(JSON.stringify({id:1,method:'Browser.close'}));
 await Promise.race([
  new Promise(resolve=>socket.addEventListener('close',()=>resolve(),{once:true})),
  delay(5000),
 ]);
 try{socket.close();}catch{}
}

const profile=await mkdtemp(join(tmpdir(),'usshm-extension-cft-profile-'));
const extension=await mkdtemp(join(tmpdir(),'usshm-extension-cft-unpacked-'));
const server=createServer((request,response)=>{
 if(request.method!=='GET'||request.url!=='/fixture'){
  response.writeHead(404,{'content-type':'text/plain'}).end('not found');
  return;
 }
 response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
 response.end('<!doctype html><html><head><title>Isolated CFT extension fixture</title></head><body><main id="usshm-fixture-only">Local fixture only</main></body></html>');
});
let running=false;
let chrome;
let stderr='';
try{
 // Generated from fixed source at test time; no user scripts, credentials,
 // arbitrary extension IDs or remote extension download URLs are accepted.
 const manifest='{"manifest_version":3,"name":"USSHM Synthetic Extension Fixture","version":"0.0.1","background":{"service_worker":"background.js"},"content_scripts":[{"matches":["http://127.0.0.1/*"],"js":["content.js"],"run_at":"document_idle"}]}';
 // Fixed synthetic echo over the REAL MV3 content -> service-worker ->
 // content path. API property presence alone must never pass this control.
 const background=`chrome.runtime.onMessage.addListener((request,sender,reply)=>{
  try{
   if(!request||request.kind!=="usshm-synthetic-runtime-ping"||
      sender.id!==chrome.runtime.id||typeof sender.url!=="string")return false;
   const url=new URL(sender.url);
   if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||
      url.pathname!=="/fixture"||url.username||url.password)return false;
   reply({kind:"usshm-synthetic-runtime-pong"});
  }catch{}
  return false;
 });\n`;
 const content=`if(location.protocol==="http:"&&location.hostname==="127.0.0.1"&&
    location.pathname==="/fixture"){
  const root=document.documentElement;
  const hasListener=Boolean(globalThis.chrome?.runtime?.onMessage&&
    typeof globalThis.chrome.runtime.onMessage.addListener==="function");
  root.setAttribute("data-usshm-extension-fixture","yes");
  root.setAttribute("data-usshm-extension-runtime-onmessage",hasListener?"yes":"no");
  try{
   if(typeof chrome.runtime.sendMessage!=="function")throw Error("missing runtime");
   chrome.runtime.sendMessage({kind:"usshm-synthetic-runtime-ping"},(response)=>{
    const error=chrome.runtime.lastError;
    const valid=!error&&response&&typeof response==="object"&&
     Object.keys(response).length===1&&
     response.kind==="usshm-synthetic-runtime-pong";
    root.setAttribute("data-usshm-extension-roundtrip",valid?"yes":"no");
   });
  }catch{
   root.setAttribute("data-usshm-extension-roundtrip","no");
  }
 }\n`;
 await writeFile(join(extension,'manifest.json'),manifest,{flag:'wx'});
 await writeFile(join(extension,'background.js'),background,{flag:'wx'});
 await writeFile(join(extension,'content.js'),content,{flag:'wx'});
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 running=true;
 const address=server.address();
 if(!address||typeof address==='string')throw new Error('Isolated extension HTTP fixture failed to bind');
 const fixtureUrl='http://127.0.0.1:'+address.port+'/fixture';
 await assertChromeDebuggerPortFree(9223);
 const launchArgs=[
  ...buildChromeLaunchArgs(9223,{isolatedProfileDir:profile}),
  '--headless=new','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-sync','--disable-gpu',
  '--disable-extensions-except='+extension,
  '--load-extension='+extension,
  '--new-window',fixtureUrl,
 ];
 chrome=spawn(executable,launchArgs,{stdio:['ignore','ignore','pipe'],windowsHide:true});
 chrome.stderr?.on('data',x=>{stderr=(stderr+String(x)).slice(-1000);});
 let exited=false;
 chrome.on('error',error=>{stderr=(stderr+' '+String(error)).slice(-1000);exited=true;});
 chrome.on('exit',()=>{exited=true;});
 let selected=null,verified=false,lastReason='not ready',initialStatus=null;
 for(let attempt=0;attempt<85;attempt++){
  if(exited)throw new Error('Isolated Chrome exited before extension fixture attestation');
  try{
   const status=await getVerifiedChromeStatus({port:9223});
   if(!/^(?:Chrome|HeadlessChrome|Chromium)\/155\./.test(status.browser))
    throw new Error('CFT version mismatch');
   const page=status.pages.find(p=>p.url===fixtureUrl&&p.type==='page'&&p.webSocketDebuggerUrl);
   if(page){
    const identity=await confirmPageIdentity(page);
    assert.equal(identity.confirmedUrl,fixtureUrl);
    if(!identity.frameId||!identity.loaderId)throw new Error('Unbound CFT fixture frame');
    const probe=await probePageLocators(page,[{
     method:'querySelectorAll',
     expression:'[data-usshm-extension-fixture="yes"]',
     runtimeRequired:false,
    },{
     method:'querySelectorAll',
     expression:'[data-usshm-extension-runtime-onmessage="yes"]',
     runtimeRequired:false,
    },{
     method:'querySelectorAll',
     expression:'[data-usshm-extension-roundtrip="yes"]',
     runtimeRequired:false,
    }]);
    selected=page;
    if(probe.validationLevel==='dom-only'&&probe.targetId===page.id&&
       probe.url===fixtureUrl&&probe.checks.length===3&&
       probe.checks.every(check=>check?.status==='found'&&check?.matchCount===1)){
     const after=await confirmPageIdentity(page);
     if(after.frameId!==identity.frameId||after.loaderId!==identity.loaderId)
      throw new Error('CFT fixture document reloaded during extension evidence');
     initialStatus=status;
     verified=true;
     break;
    }
    lastReason='extension or runtime messaging marker not yet injected by isolated content script';
   }
  }catch(error){lastReason=String(error).slice(0,240);}
  await delay(350);
 }
 if(!verified||!selected||!initialStatus?.browserSocket)
  throw new Error('Unpacked CFT 155 extension did not execute on localhost fixture: '+lastReason);

 // RG-05 control: restart the SAME disposable profile in a distinct Chrome
 // process, then prove an ordinary MV3 isolated-world content script still
 // receives chrome.runtime.onMessage on the first fresh localhost document.
 // This intentionally does not use userScripts/USER_SCRIPT or GM APIs.
 const previousChromePid=chrome.pid;
 const previousBrowserSocket=initialStatus.browserSocket;
 if(!Number.isSafeInteger(previousChromePid)||previousChromePid<2)
  throw new Error('Synthetic CFT control could not pin the first Chrome process');
 await requestBrowserClose(previousBrowserSocket);
 for(let i=0;i<60&&!exited;i++)await delay(250);
 if(!exited)throw new Error('Synthetic CFT first Chrome process did not exit');
 let released=false;
 for(let i=0;i<40;i++){
  try{await assertChromeDebuggerPortFree(9223);released=true;break;}
  catch{await delay(150);}
 }
 if(!released)throw new Error('Synthetic CFT debugger port remained occupied after restart boundary');

 // Reuse the exact same disposable profile and unpacked synthetic extension.
 exited=false;stderr='';
 chrome=spawn(executable,launchArgs,{stdio:['ignore','ignore','pipe'],windowsHide:true});
 chrome.stderr?.on('data',x=>{stderr=(stderr+String(x)).slice(-1000);});
 chrome.on('error',error=>{stderr=(stderr+' '+String(error)).slice(-1000);exited=true;});
 chrome.on('exit',()=>{exited=true;});
 let restartedVerified=false,restartReason='not ready',restartedStatus=null;
 for(let attempt=0;attempt<85;attempt++){
  if(exited)throw new Error('Restarted synthetic CFT exited before runtime messaging control');
  try{
   const status=await getVerifiedChromeStatus({port:9223});
   if(!/^(?:Chrome|HeadlessChrome|Chromium)\/155\./.test(status.browser))
    throw new Error('Restarted CFT version mismatch');
   if(!status.browserSocket||status.browserSocket===previousBrowserSocket||
      chrome.pid===previousChromePid)
    throw new Error('Synthetic CFT restart did not produce a distinct browser process');
   const page=status.pages.find(p=>p.url===fixtureUrl&&p.type==='page'&&p.webSocketDebuggerUrl);
   if(page){
    const identity=await confirmPageIdentity(page);
    assert.equal(identity.confirmedUrl,fixtureUrl);
    if(!identity.frameId||!identity.loaderId)throw new Error('Unbound restarted CFT fixture frame');
    const probe=await probePageLocators(page,[{
     method:'querySelectorAll',
     expression:'[data-usshm-extension-fixture="yes"]',
     runtimeRequired:false,
    },{
     method:'querySelectorAll',
     expression:'[data-usshm-extension-runtime-onmessage="yes"]',
     runtimeRequired:false,
    },{
     method:'querySelectorAll',
     expression:'[data-usshm-extension-roundtrip="yes"]',
     runtimeRequired:false,
    }]);
    if(probe.validationLevel==='dom-only'&&probe.targetId===page.id&&
       probe.url===fixtureUrl&&probe.checks.length===3&&
       probe.checks.every(check=>check?.status==='found'&&check?.matchCount===1)){
     const after=await confirmPageIdentity(page);
     if(after.frameId!==identity.frameId||after.loaderId!==identity.loaderId)
      throw new Error('Restarted CFT fixture document reloaded during extension evidence');
     restartedStatus=status;
     restartedVerified=true;
     break;
    }
    restartReason='runtime messaging marker absent after process restart';
   }
  }catch(error){restartReason=String(error).slice(0,240);}
  await delay(350);
 }
 if(!restartedVerified||!restartedStatus)
  throw new Error('Synthetic CFT runtime messaging cold-restart control failed: '+restartReason);
 console.log('PASS real CFT 155 synthetic MV3 isolated-world runtime messaging survived process restart; a verified roundtrip survived process restart on both isolated loopback documents using the same disposable profile. NOT USER_SCRIPT, Tampermonkey or GM_* V4.');
}catch(error){
 console.error('FAIL isolated CFT 155 extension fixture:',error instanceof Error?error.message:'unknown');
 if(stderr)console.error('CFT stderr (tail):',stderr);
 process.exitCode=1;
}finally{
 if(chrome?.pid){
  // Kill only this newly spawned CFT process tree, never a user's Chrome.
  spawnSync('taskkill',['/PID',String(chrome.pid),'/T','/F'],
   {stdio:'ignore',timeout:15000});
 }
 if(running)await new Promise(resolve=>server.close(()=>resolve()));
 await rm(extension,{recursive:true,force:true,maxRetries:5,retryDelay:250}).catch(()=>{});
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250}).catch(()=>{});
}
