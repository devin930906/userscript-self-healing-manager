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
import {access,mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {buildChromeLaunchArgs,getChromeStatus} from '../packages/cdp-client/src/index.ts';
import {confirmPageIdentity} from '../packages/cdp-client/src/page-identity.ts';
import {captureDomSummary} from '../packages/cdp-client/src/snapshot.ts';
import {probePageLocators} from '../packages/cdp-client/src/locator-probe.ts';
import {captureCandidateNodes} from '../packages/cdp-client/src/candidate-snapshot.ts';
import {suggestCandidateRepairs} from '../packages/candidate-engine/src/workflow.ts';
import {diagnoseScriptsOnPage} from '../packages/scan-service/src/batch-dom.ts';
import {collectPagedDomDiagnosis} from '../packages/scan-service/src/paginated-dom.ts';
import {createRepairWorkflow} from '../packages/repair-workflow/src/index.ts';
import {activateManagedRevision} from '../packages/repair-workflow/src/history.ts';
import {exportManagedCurrent} from '../packages/repair-workflow/src/export.ts';

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
const html='<!doctype html><html><head><title>USSHM CDP local fixture</title></head><body><main><button id="heal-button" name="heal-action" class="heal-button-unique" data-testid="heal-control">Action</button><div class="target-pane"></div></main></body></html>';
const server=createServer((req,res)=>{
 res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
 res.end(html);
});
let chrome;
let exportRoot;
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

 for(const [method,oldSelector,expected] of [
  ['getElementsByName','legacy-action','heal-action'],
  ['getElementsByClassName','legacy-class','heal-button-unique'],
 ]){
  const repair=await suggestCandidateRepairs({
   target:{id:selected.id,url:selected.url},
   locator:{method,expression:oldSelector,runtimeRequired:false},
   deps:{probe:locators=>probePageLocators(selected,locators),capture:()=>captureCandidateNodes(selected)},
  });
  assert.ok(repair.some(x=>x.expression===expected&&x.validationLevel==='dom-candidate-verified'),
   'real CDP must verify raw name/class candidate for '+method);
 }

 const scope={match:['http://127.0.0.1/*'],include:[],raw:{}};
 const fakeAnalysis=(expression,runtimeRequired=false)=>({metadata:scope,selectorRecords:[{method:'querySelector',expression,runtimeRequired,receiver:'document'}]});
 const bulk=await diagnoseScriptsOnPage({items:[
  {path:'missing.user.js',scriptId:'missing',status:'parsed',analysis:fakeAnalysis('#old-heal-button')},
  {path:'present.user.js',scriptId:'present',status:'parsed',analysis:fakeAnalysis('#heal-button')},
  {path:'outside.user.js',scriptId:'outside',status:'parsed',analysis:{metadata:{match:['https://elsewhere.test/*'],include:[],raw:{}},selectorRecords:[]}},
  {path:'dynamic.user.js',scriptId:'dynamic',status:'parsed',analysis:fakeAnalysis('template',true)},
 ],target:selected,consent:true,deps:{confirm:confirmPageIdentity,probe:probePageLocators}});
 assert.deepEqual(bulk.items.map(x=>x.status),['locator-missing','dom-present','out-of-scope','needs-review']);

 // Exercise three real Chrome-backed paginated requests, including all-out-of-scope
 // entries that must still be bounded by current top-frame identity checks.
 const bulkScripts=Array.from({length:51},(_,i)=>i%25===0?{
  path:'matched-'+i+'.user.js',scriptId:'matched-'+i,status:'parsed',analysis:fakeAnalysis('#heal-button'),
 }:{
  path:'outside-'+i+'.user.js',scriptId:'outside-'+i,status:'parsed',
  analysis:{metadata:{match:['https://elsewhere.test/*'],include:[],raw:{}},selectorRecords:[]},
 });
 const realPaged=await collectPagedDomDiagnosis({
  total:bulkScripts.length,targetId:selected.id,isCancelled:()=>false,onProgress:()=>{},
  requestPage:async offset=>{
   const single=await diagnoseScriptsOnPage({
    items:bulkScripts.slice(offset,offset+25),target:selected,consent:true,
    deps:{confirm:confirmPageIdentity,probe:probePageLocators},
   });
   return {...single,startIndex:offset,items:single.items.map(row=>({...row,index:row.index+offset})),
    remainingItems:bulkScripts.length-offset-single.items.length};
  },
 });
 assert.equal(realPaged.items.length,51);
 assert.equal(realPaged.remainingItems,0);
 assert.equal(realPaged.items.filter(x=>x.status==='dom-present').length,3);
 assert.equal(realPaged.items.filter(x=>x.status==='out-of-scope').length,48);


 // End-to-end local revision lifecycle using a synthetic fixture source only.
 // Applying a managed patch never changes the original .user.js file.
 const chosen=candidates.find(x=>x.expression==='#heal-button');
 assert.ok(chosen);
 const sourcePath=join(profile,'fixture.user.js');
 const original='// ==UserScript==\n// @name Local CDP Smoke\n// @match http://127.0.0.1/*\n// ==/UserScript==\ndocument.querySelector("#old-heal-button");\ndocument.querySelector(".old-target-pane");\n';
 await writeFile(sourcePath,original,'utf8');
 const flow=createRepairWorkflow({managedRoot:profile});
 const draft=await flow.propose({sourcePath,scriptId:'chrome-smoke-fixture',oldSelector:'#old-heal-button',newSelector:chosen.expression});
 assert.match(draft.preview,/heal-button/);
 const applied=await flow.apply({proposalId:draft.proposalId,approved:true});
 assert.equal(await readFile(sourcePath,'utf8'),original);
 assert.match(await readFile(applied.managedPath,'utf8'),/#heal-button/);
 const active=join(profile,'managed','chrome-smoke-fixture','current.user.js');
 assert.equal(await readFile(active,'utf8'),await readFile(applied.managedPath,'utf8'));
 // The second repair must build on the first one, rather than reloading the source.
 const nextProposal=await flow.propose({sourcePath,scriptId:'chrome-smoke-fixture',oldSelector:'.old-target-pane',newSelector:'.target-pane'});
 const nextReceipt=await flow.apply({proposalId:nextProposal.proposalId,approved:true});
 const combinedRevision=await readFile(active,'utf8');
 assert.match(combinedRevision,/#heal-button/);
 assert.match(combinedRevision,/\.target-pane/);
 assert.doesNotMatch(combinedRevision,/old-heal-button|old-target-pane/);
 assert.equal(combinedRevision,await readFile(nextReceipt.managedPath,'utf8'));
 assert.equal(await readFile(nextReceipt.backupPath,'utf8'),await readFile(applied.managedPath,'utf8'));
 exportRoot=await mkdtemp(join(tmpdir(),'usshm-export-smoke-'));
 const exported=await exportManagedCurrent({managedRoot:profile,scriptId:'chrome-smoke-fixture',destinationPath:join(exportRoot,'checked.user.js')});
 assert.match(await readFile(exported.path,'utf8'),/#heal-button/);
 assert.equal(await readFile(sourcePath,'utf8'),original);
 const restored=await activateManagedRevision({managedRoot:profile,scriptId:'chrome-smoke-fixture',hash:draft.baseHash,approved:true});
 assert.equal(await readFile(restored.activePath,'utf8'),original);
 await confirmPageIdentity(selected);
 console.log('PASS real Chrome CDP: page identity, 51-script batches, CSS/name/class candidates, two cumulative managed repairs, export and restore.');
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
 if(exportRoot)await rm(exportRoot,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
}
