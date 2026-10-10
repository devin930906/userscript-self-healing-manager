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
 const manifest='{"manifest_version":3,"name":"USSHM Synthetic Extension Fixture","version":"0.0.1","content_scripts":[{"matches":["http://127.0.0.1/*"],"js":["content.js"],"run_at":"document_idle"}]}';
 const content='if(location.protocol==="http:"&&location.hostname==="127.0.0.1"&&location.pathname==="/fixture"){document.documentElement.setAttribute("data-usshm-extension-fixture","yes");}\n';
 await writeFile(join(extension,'manifest.json'),manifest,{flag:'wx'});
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
 chrome=spawn(executable,[
  ...buildChromeLaunchArgs(9223,{isolatedProfileDir:profile}),
  '--headless=new','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-sync','--disable-gpu',
  '--disable-extensions-except='+extension,
  '--load-extension='+extension,
  '--new-window',fixtureUrl,
 ],{stdio:['ignore','ignore','pipe'],windowsHide:true});
 chrome.stderr?.on('data',x=>{stderr=(stderr+String(x)).slice(-1000);});
 let exited=false;
 chrome.on('error',error=>{stderr=(stderr+' '+String(error)).slice(-1000);exited=true;});
 chrome.on('exit',()=>{exited=true;});
 let selected=null,verified=false,lastReason='not ready';
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
    }]);
    selected=page;
    if(probe.validationLevel==='dom-only'&&probe.targetId===page.id&&
       probe.url===fixtureUrl&&probe.checks.length===1&&
       probe.checks[0]?.status==='found'&&probe.checks[0]?.matchCount===1){
     const after=await confirmPageIdentity(page);
     if(after.frameId!==identity.frameId||after.loaderId!==identity.loaderId)
      throw new Error('CFT fixture document reloaded during extension evidence');
     verified=true;
     break;
    }
    lastReason='extension marker not yet injected by isolated content script';
   }
  }catch(error){lastReason=String(error).slice(0,240);}
  await delay(350);
 }
 if(!verified||!selected)
  throw new Error('Unpacked CFT 155 extension did not execute on localhost fixture: '+lastReason);
 console.log('PASS real CFT 155 isolated MV3 extension content-script injection into localhost fixture; NOT Tampermonkey / GM_* V4.');
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
