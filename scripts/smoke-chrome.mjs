/**
 * Real external Chrome + CDP integration smoke, Windows development CI only.
 * Uses a disposable Chrome profile and a loopback-only HTML fixture. It never
 * loads Tampermonkey, executes userscript code, uploads files, or packages an EXE.
 *
 * Run: node --experimental-strip-types scripts/smoke-chrome.mjs
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {buildChromeLaunchArgs,getChromeStatus} from '../packages/cdp-client/src/index.ts';
import {confirmPageIdentity} from '../packages/cdp-client/src/page-identity.ts';
import {captureDomSummary} from '../packages/cdp-client/src/snapshot.ts';
import {probePageLocators} from '../packages/cdp-client/src/locator-probe.ts';
import {captureCandidateNodes} from '../packages/cdp-client/src/candidate-snapshot.ts';
import {suggestCandidateRepairs} from '../packages/candidate-engine/src/workflow.ts';

if(process.platform!=='win32')throw new Error('Real Chrome smoke is for Windows CI; no Linux browser substitutions');
const candidates=[
 process.env.CHROME_PATH,
 process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,'Google','Chrome','Application','chrome.exe'),
 process.env['PROGRAMFILES(X86)']&&join(process.env['PROGRAMFILES(X86)'],'Google','Chrome','Application','chrome.exe'),
 process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Google','Chrome','Application','chrome.exe'),
].filter(Boolean);
let executable;
for(const path of candidates){try{await access(path);executable=path;break;}catch{}}
if(!executable)throw new Error('Chrome is not installed in the Windows runner; cannot claim browser CDP smoke PASS');

const profile=await mkdtemp(join(tmpdir(),'usshm-chrome-smoke-'));
const html='<!doctype html><html><head><title>USSHM CDP local fixture</title></head><body><main><button id="heal-button" data-testid="heal-control">Action</button><div class="target-pane"></div></main></body></html>';
const server=createServer((req,res)=>{
 res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
 res.end(html);
});
let chrome;
let diagnostics='';
try{
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 const address=server.address();
 if(!address||typeof address==='string')throw new Error('Failed to bind local HTTP fixture');
 const fixtureUrl='http://127.0.0.1:'+address.port+'/fixture';
 chrome=spawn(executable,[
  ...buildChromeLaunchArgs(9223,{isolatedProfileDir:profile}),
  '--headless=new','--no-first-run','--no-default-browser-check',
  '--disable-extensions','--disable-background-networking','--disable-sync',
  '--disable-gpu','--new-window',fixtureUrl,
 ],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 chrome.stderr?.on('data',chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-1800);});
 let spawnFailure;
 chrome.on('error',error=>{spawnFailure=error;});
 let selected;
 let lastIdentityError='';
 for(let attempt=0;attempt<55;attempt++){
  if(spawnFailure)throw spawnFailure;
  try{
   const status=await getChromeStatus({port:9223});
   const candidate=status.pages.find(x=>x.url===fixtureUrl&&x.webSocketDebuggerUrl);
   if(candidate){
    // /json/list may announce the URL just before the top FrameTree is ready.
    // Wait for the live frame to confirm before treating this as browser-ready.
    try{
     await confirmPageIdentity(candidate);
     selected=candidate;
     break;
    }catch(error){lastIdentityError=String(error);}
   }
  }catch{ /* Chrome may not have opened its CDP port yet. */ }
  await delay(300);
 }
 if(!selected)throw new Error('Real Chrome did not expose a frame-confirmed loopback fixture: '+lastIdentityError+' '+diagnostics);
 const identity=await confirmPageIdentity(selected);
 assert.equal(identity.confirmedUrl,fixtureUrl);
 const summary=await captureDomSummary(selected);
 assert.ok(summary.nodeCount>0,'must capture real DOM nodes');
 assert.ok(summary.documentCount>=1);
 const result=await probePageLocators(selected,[
  {method:'querySelector',expression:'#heal-button',runtimeRequired:false},
  {method:'getElementById',expression:'heal-button',runtimeRequired:false},
  {method:'querySelector',expression:'.this-selector-is-missing',runtimeRequired:false},
 ]);
 assert.deepEqual(result.checks.map(x=>x.status),['found','found','missing']);
 assert.deepEqual(result.checks.map(x=>x.matchCount),[1,1,0]);
 // Exercise the actual offline-first repair recommendation flow against Chrome.
 const evidence=await captureCandidateNodes(selected);
 assert.ok(evidence.nodes.some(x=>x.attributes.id==='heal-button'));
 const candidates=await suggestCandidateRepairs({
  target:{id:selected.id,url:selected.url},
  locator:{method:'querySelector',expression:'#old-heal-button',runtimeRequired:false},
  deps:{probe:(locators)=>probePageLocators(selected,locators),capture:()=>captureCandidateNodes(selected)},
 });
 assert.ok(candidates.some(x=>x.expression==='#heal-button'&&x.validationLevel==='dom-candidate-verified'),
  'a missing selector should yield a uniquely matched, DOM-confirmed candidate');
 await confirmPageIdentity(selected);
 console.log('PASS real Chrome CDP: frame identity, DOM snapshot, selectors [found,found,missing], candidate capture and confirmation.');
 console.log('Evidence only; not Tampermonkey/GM_* functional validation.');
}catch(error){
 console.error('FAIL real Chrome CDP smoke:',error);
 if(diagnostics)console.error('Chrome stderr (tail):',diagnostics);
 process.exitCode=1;
}finally{
 if(chrome?.pid){
  // Kill only this newly spawned isolated browser process tree, never the user's Chrome.
  spawnSync('taskkill',['/PID',String(chrome.pid),'/T','/F'],{stdio:'ignore',timeout:15000});
 }
 await new Promise(resolve=>server.close(()=>resolve()));
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
}
