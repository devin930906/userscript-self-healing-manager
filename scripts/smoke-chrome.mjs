/**
 * Real external Chrome + CDP integration smoke, Windows development CI only.
 * Uses a disposable Chrome profile and a loopback-only HTML fixture. It never
 * loads Tampermonkey, uploads files, or packages an EXE. It executes only its\n * own synthetic fixture code inside this disposable localhost browser.
 *
 * Run: node --experimental-strip-types scripts/smoke-chrome.mjs
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {access,mkdir,mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {buildChromeLaunchArgs,getChromeStatus,waitForChromeDebugger,assertChromeDebuggerPortFree} from '../packages/cdp-client/src/index.ts';
import {confirmPageIdentity} from '../packages/cdp-client/src/page-identity.ts';
import {captureDomSummary} from '../packages/cdp-client/src/snapshot.ts';
import {probePageLocators} from '../packages/cdp-client/src/locator-probe.ts';
import {inspectReadOnlyElementVisibility,qualifyTopDocumentVisibility} from '../packages/cdp-client/src/read-only-visibility.ts';
import {captureCandidateNodes} from '../packages/cdp-client/src/candidate-snapshot.ts';
import {suggestCandidateRepairs,suggestAdapterScopedRepairs} from '../packages/candidate-engine/src/workflow.ts';
import {suggestMissingCandidatesBulk} from '../packages/candidate-engine/src/bulk.ts';
import {savePreferredChromePath,loadPreferredChromePath} from '../packages/cdp-client/src/preferred-chrome.ts';
import {createBrowserProfile,listBrowserProfiles,setDefaultBrowserProfile,resolveBrowserProfileForLaunch} from '../packages/cdp-client/src/browser-profiles.ts';
import {diagnoseScriptsOnPage} from '../packages/scan-service/src/batch-dom.ts';
import {runReadOnlyDomContract} from '../packages/test-runner/src/index.ts';
import {runSiteAdapterRoleDomCheck} from '../packages/test-runner/src/site-adapter-role.ts';
import {parseSiteAdapter} from '../packages/candidate-engine/src/site-adapter.ts';
import {collectPagedDomDiagnosis} from '../packages/scan-service/src/paginated-dom.ts';
import {createRepairWorkflow} from '../packages/repair-workflow/src/index.ts';
import {readVerifiedManagedLocator} from '../packages/repair-workflow/src/managed-locator.ts';
import {guardAppliedManagedRevision} from '../packages/repair-workflow/src/guarded-v1.ts';
import {activateManagedRevision} from '../packages/repair-workflow/src/history.ts';
import {exportManagedCurrent} from '../packages/repair-workflow/src/export.ts';
import {runIsolatedFixtureBehavior} from './local-fixture-behavior.ts';
import {runIsolatedFixtureInteraction} from './local-fixture-interaction.ts';

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
const html=`<!doctype html><html><head><title>USSHM CDP local fixture</title></head>
<body><main><button id="heal-button" name="heal-action" class="heal-button-unique" data-testid="heal-control">Action</button>
<button id="fixture-safe-click" type="button">Safe synthetic interaction</button>
<button id="disabled-demo" disabled>Disabled</button><button id="aria-disabled-demo" aria-disabled="true">ARIA disabled</button><input id="readonly-demo" readonly value="synthetic"><div class="target-pane"></div><button class="batch-role">A</button><button class="batch-role">B</button><iframe id="fixture-child" src="/child" title="read only child"></iframe><div id="shadow-host"></div><div id="closed-shadow-host"></div></main>
<script>
 document.getElementById('fixture-safe-click').addEventListener('click',event=>{
  event.currentTarget.setAttribute('data-usshm-v2-fixture','yes');
 });
 const shadowRoot=document.getElementById('shadow-host').attachShadow({mode:'open'});
 const shadowButton=document.createElement('span');
 shadowButton.id='shadow-only';
 shadowRoot.appendChild(shadowButton);
 const closedRoot=document.getElementById('closed-shadow-host').attachShadow({mode:'closed'});
 const closedChild=document.createElement('span');
 closedChild.id='closed-shadow-only';
 closedRoot.appendChild(closedChild);
</script></body></html>`;
const server=createServer((req,res)=>{
 res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
 if(req.url==='/child')res.end('<!doctype html><html><body><button id="iframe-only">Child</button></body></html>');
 else res.end(html);
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
 let exitDetails='';
 chrome.on('error',error=>{spawnFailure=error;});
 chrome.on('exit',(code,signal)=>{exitDetails='Chrome exited before CDP readiness (code='+code+', signal='+signal+')';});
 let selected;
 let lastIdentityError='',lastStatusError='',observedPageCount=0;
 // Cold Windows hosted runners can spend longer initializing first-run Chrome
 // and CDP even with an isolated profile. Do not report a protocol failure from
 // a short startup race; still fail closed if no real frame is confirmed.
 for(let attempt=0;attempt<110;attempt++){
  if(spawnFailure)throw spawnFailure;
  if(exitDetails)throw new Error(exitDetails+' '+diagnostics);
  try{
   const status=await getChromeStatus({port:9223});
   observedPageCount=status.pages.length;
   const candidate=status.pages.find(x=>x.url===fixtureUrl&&x.webSocketDebuggerUrl);
   if(candidate){
    // /json/list may announce the URL just before the top FrameTree is ready.
    try{
     await confirmPageIdentity(candidate);
     selected=candidate;
     break;
    }catch(error){lastIdentityError=String(error);}
   }
  }catch(error){lastStatusError=String(error).slice(0,350);}
  await delay(350);
 }
 if(!selected)throw new Error('Real Chrome did not expose a frame-confirmed loopback fixture. Last CDP status='+lastStatusError+
  '; observed page count='+observedPageCount+'; frame identity='+lastIdentityError+'; Chrome stderr='+diagnostics);
 // A successful process spawn is not enough: the real running Chrome must
 // expose a verified localhost browser websocket. The live port must also
 // reject a second launch so we never misattribute an existing session.
 const verifiedDebugger=await waitForChromeDebugger({port:9223,timeoutMs:5000});
 assert.ok(verifiedDebugger.browserSocket?.includes('/devtools/browser/'));

 // FR-002 actual browser-profile isolation smoke, not just a record parser:
 // save two independent named configurations, then launch a REAL Chrome
 // process under each derived Data/Chrome-Profiles/<UUID> directory. Both
 // must independently complete a loopback CDP browser-socket handshake.
 const profilesData=join(profile,'USSHM-App-Data');
 await mkdir(profilesData);
 const savedFirst=await createBrowserProfile({
  dataRoot:profilesData,name:'Chrome 155 Primary',executablePath:executable,
 });
 const savedSecond=await createBrowserProfile({
  dataRoot:profilesData,name:'Chrome 155 Isolated',executablePath:executable,
 });
 assert.notEqual(savedFirst.id,savedSecond.id);
 await setDefaultBrowserProfile({dataRoot:profilesData,profileId:savedSecond.id});
 assert.deepEqual((await listBrowserProfiles({dataRoot:profilesData})).map(x=>x.isDefault),[false,true]);
 for(const [saved,port] of [[savedFirst,9231],[savedSecond,9232]]){
  const {executablePath,isolatedProfileDir}=await resolveBrowserProfileForLaunch({
   dataRoot:profilesData,profileId:saved.id,
  });
  assert.equal(executablePath,executable);
  assert.ok(isolatedProfileDir.includes('Chrome-Profiles'));
  assert.ok(isolatedProfileDir.includes(saved.id));
  await assertChromeDebuggerPortFree(port);
  let failure=null,exited=false;
  const instance=spawn(executablePath,[
   ...buildChromeLaunchArgs(port,{isolatedProfileDir}),
   '--headless=new','--no-first-run','--no-default-browser-check',
   '--disable-extensions','--disable-background-networking',
   '--disable-gpu','about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  instance.on('error',error=>{failure=error;});
  instance.on('exit',()=>{exited=true;});
  try{
   const live=port===9231?
    await waitForChromeDebugger({port:9231,timeoutMs:25000,hasExited:()=>failure!==null||exited}):
    await waitForChromeDebugger({port:9232,timeoutMs:25000,hasExited:()=>failure!==null||exited});
   assert.ok(['Chrome/','HeadlessChrome/','Chromium/'].some(prefix=>live.browser.startsWith(prefix)));
   await access(isolatedProfileDir);
  }finally{
   if(instance.pid)spawnSync('taskkill',['/PID',String(instance.pid),'/T','/F'],
    {stdio:'ignore',timeout:15000});
  }
 }
 console.log('PASS real Chrome FR-002: two persisted, independent UUID profile directories and live CDP handshakes.');

 // Optional release-compatibility job: assert the PRODUCT reported by the
 // live CDP browser socket, not a downloaded archive filename or a fixture.
 const expectedMajor=process.env.USSHM_SMOKE_EXPECT_CHROME_MAJOR;
 if(expectedMajor!==undefined){
  if(!/^[0-9]{2,3}$/.test(expectedMajor)||
     !new RegExp('^(?:Chrome|Chromium|HeadlessChrome)/'+expectedMajor+'\\.').test(verifiedDebugger.browser))
   throw new Error('Chrome smoke browser major mismatch: expected '+expectedMajor+
    ', actual CDP product '+verifiedDebugger.browser);
 }
 await assert.rejects(assertChromeDebuggerPortFree(9223),/port.*(in use|unavailable)/i);
 // Verify the actual installed Chrome EXE survives a preference reload (no autorun).
 await savePreferredChromePath({dataRoot:profile,executablePath:executable});
 assert.equal(await loadPreferredChromePath({dataRoot:profile}),executable);
 const identity=await confirmPageIdentity(selected);
 assert.equal(identity.confirmedUrl,fixtureUrl);
 assert.ok(identity.frameId&&identity.loaderId,'real Chrome must expose stable main-frame and loader identity');
 const summary=await captureDomSummary(selected);
 assert.ok(summary.nodeCount>0,'must capture real DOM nodes');
 assert.ok(summary.documentCount>=1);
 assert.ok(summary.authorShadowTreeNodes>=2,'real Chrome must expose both open and closed author Shadow Trees in DOMSnapshot');
 // This isolated fixture is the ONLY CDP Input target in our suite. Verify a
 // real browser click and observable local side effect without running scripts
 // from users, without arbitrary JS injection, and without elevating app V2/V3/V4.
 const syntheticInteraction=await runIsolatedFixtureInteraction({
  approved:true,target:selected,fixtureUrl,
 });
 assert.equal(syntheticInteraction.validationLevel,'synthetic-fixture-interaction');
 assert.equal(syntheticInteraction.observed,true,'real Chrome must dispatch safe input on local fixture');
 assert.equal(syntheticInteraction.productionEligible,false);
 const result=await probePageLocators(selected,[
  {method:'querySelector',expression:'#heal-button',runtimeRequired:false},
  {method:'getElementById',expression:'heal-button',runtimeRequired:false},
  {method:'querySelector',expression:'.this-selector-is-missing',runtimeRequired:false},
 ]);
 assert.deepEqual(result.checks.map(x=>x.status),['found','found','missing']);
 assert.deepEqual(result.checks.map(x=>x.matchCount),[1,1,0]);
 // Exercise the SiteAdapter V1 role contract against real external Chrome.
 // All role assertions remain DOM-only, never userscript/GM_* proof.
 const siteAdapter=parseSiteAdapter({
  schemaVersion:1,siteId:'fixture-site',version:'1.0.0',
  urlPatterns:['http://127.0.0.1/*'],
  states:{ready:{description:'Synthetic fixture ready'}},
  roles:{
   'fixture.healButton':{
    contexts:[{stateId:'ready',frame:'top',shadow:'none'}],
    strategies:[{kind:'css',selector:'#heal-button',weight:100},{kind:'css',selector:'#missing-backup',weight:40}],
    cardinality:{min:1,max:1},assertions:['unique'],
   },
   'fixture.batchButtons':{
    contexts:[{stateId:'ready',frame:'top',shadow:'none'}],
    strategies:[{kind:'css',selector:'.batch-role',weight:100}],
    cardinality:{min:2,max:2},assertions:['exists'],
   },
   'fixture.iframeButton':{
    contexts:[{stateId:'ready',frame:'iframe',shadow:'none'}],
    strategies:[{kind:'css',selector:'#iframe-only',weight:100}],
    cardinality:{min:1,max:1},assertions:['unique'],
   },
   'fixture.openShadow':{
    contexts:[{stateId:'ready',frame:'top',shadow:'open'}],
    strategies:[{kind:'css',selector:'#shadow-only',weight:100}],
    cardinality:{min:1,max:1},assertions:['unique'],
   },
   'fixture.shadowOnly':{
    contexts:[{stateId:'ready',frame:'top',shadow:'none'}],
    strategies:[{kind:'css',selector:'#shadow-only',weight:100}],
    cardinality:{min:1,max:1},assertions:['unique'],
   },
  },validationCases:['HEAL_DOM'],
 });
 const roleDeps={
  confirm:confirmPageIdentity,
  probe:(page,locators)=>probePageLocators(page,locators,{includeNodeFingerprints:true}),
  probeOpenShadow:(page,locators)=>probePageLocators(page,locators,{includeNodeFingerprints:true,rootScope:'open-shadow'}),
  probeIframe:(page,locators,frameId)=>probePageLocators(page,locators,{includeNodeFingerprints:true,rootScope:'iframe-document',expectedFrameId:frameId}),
  summarize:captureDomSummary,
  wait:()=>delay(120),
 };
 const matchedRole=await runSiteAdapterRoleDomCheck({
  approved:true,target:selected,adapter:siteAdapter,roleId:'fixture.healButton',
  declaredStateId:'ready',deps:roleDeps,
 });
 assert.equal(matchedRole.status,'matched-v1','real Chrome must confirm exactly one semantic fallback');
 assert.equal(matchedRole.V3,'not-configured');
 assert.equal(matchedRole.V4,'not-configured');
 assert.equal(matchedRole.declaredStateVerified,false);
 const shadowRole=await runSiteAdapterRoleDomCheck({
  approved:true,target:selected,adapter:siteAdapter,roleId:'fixture.shadowOnly',
  declaredStateId:'ready',deps:roleDeps,
 });
 assert.equal(shadowRole.status,'needs-review','shadow-only role cannot be marked definitively absent');
 const openShadowRole=await runSiteAdapterRoleDomCheck({
  approved:true,target:selected,adapter:siteAdapter,roleId:'fixture.openShadow',
  declaredStateId:'ready',deps:roleDeps,
 });
 assert.equal(openShadowRole.status,'matched-v1','real Chrome must attest an explicitly selected open ShadowRoot');
 assert.equal(openShadowRole.matchedSelector,'#shadow-only');
 assert.equal(openShadowRole.functionalVerified,false);
 assert.equal(openShadowRole.V3,'not-configured');
 assert.equal(openShadowRole.V4,'not-configured');
 const childIdentity=await confirmPageIdentity(selected);
 assert.equal(childIdentity.subframeCount,1,'fixture has exactly one child frame');
 assert.ok(childIdentity.soleSameOriginSubframe?.loaderId,'must pin same-origin iframe loader');
 const iframeRole=await runSiteAdapterRoleDomCheck({
  approved:true,target:selected,adapter:siteAdapter,roleId:'fixture.iframeButton',
  declaredStateId:'ready',deps:roleDeps,
 });
 assert.equal(iframeRole.status,'matched-v1','real Chrome must attest the sole same-process iframe contentDocument');
 assert.equal(iframeRole.matchedSelector,'#iframe-only');
 assert.equal(iframeRole.functionalVerified,false);
 assert.equal(iframeRole.managerVerified,false);
 assert.equal(iframeRole.V3,'not-configured');
 assert.equal(iframeRole.V4,'not-configured');
 const multiRole=await runSiteAdapterRoleDomCheck({
  approved:true,target:selected,adapter:siteAdapter,roleId:'fixture.batchButtons',
  declaredStateId:'ready',deps:roleDeps,
 });
 assert.equal(multiRole.status,'matched-v1','real Chrome must fingerprint both batch-role nodes');
 assert.equal(multiRole.matchedSelector,'.batch-role');
 assert.equal(multiRole.evidenceLevel,'V1');
 assert.equal(multiRole.functionalVerified,false);
 assert.equal(multiRole.managerVerified,false);
 assert.equal(multiRole.V3,'not-configured');
 // Top-document selectors cannot see author ShadowRoots. Even @noframes does
 // not restrict shadow-root access, so a miss is review-required, not broken.
 const shadowFixture={
  path:'shadow-only.user.js',scriptId:'shadow-fixture',status:'parsed',
  analysis:{metadata:{match:['http://127.0.0.1/*'],include:[],raw:{noframes:['']}},
   selectorRecords:[{method:'querySelector',expression:'#shadow-only',runtimeRequired:false,receiver:'document'}]},
 };
 const shadowBatch=await diagnoseScriptsOnPage({
  items:[shadowFixture],target:selected,consent:true,
  deps:{confirm:confirmPageIdentity,probe:probePageLocators,summarize:captureDomSummary},
 });
 assert.equal(shadowBatch.items[0]?.status,'needs-review','ShadowRoot-only target must not be marked broken');
 assert.match(shadowBatch.items[0]?.reason??'',/Shadow DOM/i);

 const shadowContract=await runReadOnlyDomContract({
  approved:true,target:selected,caseId:'SYNTHETIC:shadow-only:exists',
  locator:{method:'querySelector',expression:'#shadow-only',runtimeRequired:false},
  expectation:'exists',deps:{
   confirm:confirmPageIdentity,probe:probePageLocators,summarize:captureDomSummary,
   wait:()=>delay(125),
  },
 });
 assert.equal(shadowContract.status,'needs-review',
  'a ShadowRoot-only target must not cause a definitive failed top-document contract');
 assert.equal(shadowContract.matchCount,null);
 assert.equal(shadowContract.V3,'not-configured');
 // Check the actual Chrome ShadowRoot fixture through the same conservative
 // visibility qualification used by the Electron main process.
 const rawShadowVisibility=await inspectReadOnlyElementVisibility(selected,{
  method:'querySelector',expression:'#shadow-only',runtimeRequired:false,
 });
 assert.equal(rawShadowVisibility.status,'missing','top document does not pierce ShadowRoot');
 const authorContext=await captureDomSummary(selected);
 assert.ok(authorContext.authorShadowTreeNodes>0,'the synthetic page contains author Shadow DOM');
 const shadowIdentity=await confirmPageIdentity(selected);
 const qualifiedShadowVisibility=qualifyTopDocumentVisibility(rawShadowVisibility,
  shadowIdentity.subframeCount??0,authorContext.authorShadowTreeNodes);
 assert.equal(qualifiedShadowVisibility.status,'unknown',
  'ShadowRoot-only targets must not appear definitively absent in visibility UI');
 assert.equal(qualifiedShadowVisibility.V2,'blocked');



 // Use the real Chrome DOM domain to verify a named non-destructive
 // locator contract with two observations and no Runtime.evaluate.
 const visibility=await inspectReadOnlyElementVisibility(selected,{
  method:'querySelector',expression:'#heal-button',runtimeRequired:false,
 });
 assert.equal(visibility.status,'potentially-visible','real Chrome DOM/CSS box should attest only potentially visible');
 assert.equal(visibility.matchCount,1);
 assert.equal(visibility.interactionVerified,false);
 assert.equal(visibility.V2,'blocked');
 assert.equal(visibility.V4,'not-configured');

 // Actual Chrome must report visible-but-disabled controls as blockers,
 // without executing a click or claiming real V2 interaction proof.
 for(const [selector,blocker] of [
  ['#disabled-demo','disabled-attribute'],
  ['#aria-disabled-demo','aria-disabled'],
  ['#readonly-demo','readonly-attribute'],
  ['#heal-button','none-detected'],
 ]){
  const control=await inspectReadOnlyElementVisibility(selected,{
   method:'querySelector',expression:selector,runtimeRequired:false,
  });
  assert.equal(control.status,'potentially-visible','direct disabled flags do not imply hidden layout: '+selector);
  assert.equal(control.controlBlocker,blocker,'Chrome CDP direct-attribute evidence for '+selector);
  assert.equal(control.interactionVerified,false);
  assert.equal(control.V2,'blocked');
  assert.equal(control.V3,'not-configured');
  assert.equal(control.V4,'not-configured');
 }


 const uniqueContract=await runReadOnlyDomContract({
  approved:true,target:selected,caseId:'SYNTHETIC:heal-button:unique',
  locator:{method:'querySelector',expression:'#heal-button',runtimeRequired:false},
  expectation:'unique',deps:{
   confirm:confirmPageIdentity,
   probe:(page,locators)=>probePageLocators(page,locators,{includeNodeFingerprints:true}),
   wait:()=>delay(125),
  },
 });
 assert.equal(uniqueContract.status,'passed');
 assert.equal(uniqueContract.evidenceLevel,'V1');
 assert.equal(uniqueContract.V3,'not-configured');
 assert.equal(uniqueContract.V4,'not-configured');

 const bulkCandidatesInputs=[
  {method:'querySelector',expression:'#old-heal-button',runtimeRequired:false},
  {method:'getElementById',expression:'old-heal-button',runtimeRequired:false},
  {method:'getElementsByName',expression:'old-action-name',runtimeRequired:false},
  {method:'getElementsByClassName',expression:'old-action-class',runtimeRequired:false},
 ];
 const bulkEvidence=await probePageLocators(selected,bulkCandidatesInputs);
 const bulkSuggestions=await suggestMissingCandidatesBulk({
  target:{id:selected.id,url:selected.url},locators:bulkCandidatesInputs,
  checks:bulkEvidence.checks,
  evidenceIdentity:{targetId:bulkEvidence.targetId,url:bulkEvidence.url},
  deps:{probe:locators=>probePageLocators(selected,locators),capture:()=>captureCandidateNodes(selected),confirm:()=>confirmPageIdentity(selected)},
 });
 assert.equal(bulkSuggestions.checkedMissing,4);
 assert.ok(bulkSuggestions.items.every(item=>item.candidates.length>0),'all four DOM methods must offer real confirmed candidates');

 // Exercise the actual offline-first repair recommendation flow against Chrome.
 const evidence=await captureCandidateNodes(selected);
 assert.ok(evidence.nodes.some(x=>x.attributes.id==='heal-button'));
 const candidates=await suggestCandidateRepairs({
  target:{id:selected.id,url:selected.url},
  locator:{method:'querySelector',expression:'#old-heal-button',runtimeRequired:false},
  deps:{probe:(locators)=>probePageLocators(selected,locators),capture:()=>captureCandidateNodes(selected),confirm:()=>confirmPageIdentity(selected)},
 });
 assert.ok(candidates.some(x=>x.expression==='#heal-button'&&x.validationLevel==='dom-candidate-verified'),
  'a missing selector should yield a uniquely matched, DOM-confirmed candidate');
 
 // Real CDP-backed adapter-filtered suggestions must stay pinned to approved
 // role definition and script locator, with no automatic patch or manager claim.
 const adapterSuggestions=await suggestAdapterScopedRepairs({
  target:{id:selected.id,url:selected.url},
  locator:{method:'querySelector',expression:'#old-heal-button',runtimeRequired:false},
  adapter:siteAdapter,roleId:'fixture.healButton',observedStateId:'ready',
  deps:{probe:locators=>probePageLocators(selected,locators),capture:()=>captureCandidateNodes(selected),confirm:()=>confirmPageIdentity(selected)},
 });
 assert.equal(adapterSuggestions.status,'candidate-only');
 assert.deepEqual(adapterSuggestions.candidates.map(c=>c.expression),['#heal-button'],
  'only the exact confirmed adapter strategy survives candidate filtering');
 assert.equal(adapterSuggestions.candidates[0]?.approved,false);
 assert.equal(adapterSuggestions.functionalVerified,false);
 const shadowSuggestions=await suggestAdapterScopedRepairs({
  target:{id:selected.id,url:selected.url},
  locator:{method:'querySelector',expression:'#old-heal-button',runtimeRequired:false},
  adapter:siteAdapter,roleId:'fixture.openShadow',observedStateId:'ready',
  deps:{probe:()=>{throw new Error('No top-document probe for open-shadow roles');},
   capture:()=>{throw new Error('No top-document capture for open-shadow roles');}},
 });
 assert.deepEqual(shadowSuggestions.candidates,[]);
 assert.equal(shadowSuggestions.rootScope,'open-shadow');


 for(const [method,oldSelector,expected] of [
  ['getElementsByName','legacy-action','heal-action'],
  ['getElementsByClassName','legacy-class','heal-button-unique'],
 ]){
  const repair=await suggestCandidateRepairs({
   target:{id:selected.id,url:selected.url},
   locator:{method,expression:oldSelector,runtimeRequired:false},
   deps:{probe:locators=>probePageLocators(selected,locators),capture:()=>captureCandidateNodes(selected),confirm:()=>confirmPageIdentity(selected)},
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
 // An iframe is now present: top-document misses and a top-frame
 // out-of-scope result cannot exclude execution in that nested context.
 assert.deepEqual(bulk.items.map(x=>x.status),['needs-review','dom-present','needs-review','needs-review']);

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
 assert.equal(realPaged.items.filter(x=>x.status==='needs-review').length,48);
 assert.equal(realPaged.items.filter(x=>x.status==='out-of-scope').length,0);


 // End-to-end local revision lifecycle using a synthetic fixture source only.
 // Applying a managed patch never changes the original .user.js file.
 const chosen=candidates.find(x=>x.expression==='#heal-button');
 assert.ok(chosen);
 const sourcePath=join(profile,'fixture.user.js');
 const original='// ==UserScript==\n// @name Local CDP Smoke\n// @match http://127.0.0.1/*\n// ==/UserScript==\nconst actionButton=document.querySelector("#old-heal-button");const targetPane=document.querySelector(".old-target-pane");\nif(actionButton&&targetPane){actionButton.setAttribute("data-usshm-functional","pass");targetPane.setAttribute("data-usshm-functional","pass");}\nif(!document.getElementById("usshm-nested-frame")){const frame=document.createElement("iframe");frame.id="usshm-nested-frame";frame.srcdoc="<button id=iframe-only>Nested DOM</button>";document.body.append(frame);}\n';
 await writeFile(sourcePath,original,'utf8');
 const baselineBehavior=await runIsolatedFixtureBehavior({target:selected,fixtureUrl,source:original});
 assert.equal(baselineBehavior,false);
 const flow=createRepairWorkflow({managedRoot:profile});
 const draft=await flow.propose({sourcePath,scriptId:'chrome-smoke-fixture',oldSelector:'#old-heal-button',newSelector:chosen.expression});
 assert.match(draft.preview,/heal-button/);
 const applied=await flow.apply({proposalId:draft.proposalId,approved:true});
 // Real Chrome V1 post-apply attestation: re-open the active managed current,
 // verify its immutable archive hash, then probe the actual patched AST
 // selector twice using stable opaque backend-node fingerprints.
 const managedVerifiedLocator=await readVerifiedManagedLocator({
  managedRoot:profile,scriptId:'chrome-smoke-fixture',
  revisionHash:applied.hash,selectorIndex:0,
 });
 assert.equal(managedVerifiedLocator.expression,'#heal-button');
 const managedContract=await runReadOnlyDomContract({
  approved:true,target:selected,caseId:'SYNTHETIC:managed-applied:V1',
  locator:{method:managedVerifiedLocator.method,
   expression:managedVerifiedLocator.expression,runtimeRequired:false},
  expectation:'unique',
  deps:{confirm:confirmPageIdentity,
   probe:(page,locators)=>probePageLocators(page,locators,{includeNodeFingerprints:true}),
   wait:()=>delay(125),
  },
 });
 assert.equal(managedContract.status,'passed');
 assert.equal(managedContract.V3,'not-configured');
 assert.equal(managedContract.managerVerified,false);
 // Deliberately approve an incorrect *managed* selector on the disposable
 // localhost fixture, then enforce automatic V1 rollback. This proves the
 // failure path against a real Chrome DOM rather than a mocked CDP response.
 const temporaryProposal=await flow.propose({sourcePath,scriptId:'chrome-smoke-fixture',
  oldSelector:'#heal-button',newSelector:'#usshm-absent-guarded'});
 const temporaryApplied=await flow.apply({proposalId:temporaryProposal.proposalId,approved:true});
 const autoGuard=await guardAppliedManagedRevision({
  approved:true,scriptId:'chrome-smoke-fixture',appliedHash:temporaryApplied.hash,
  previousHash:applied.hash,
  verify:async()=>{
   const changed=await readVerifiedManagedLocator({managedRoot:profile,
    scriptId:'chrome-smoke-fixture',revisionHash:temporaryApplied.hash,selectorIndex:0});
   assert.equal(changed.expression,'#usshm-absent-guarded');
   return runReadOnlyDomContract({
    approved:true,target:selected,caseId:'SYNTHETIC:guarded-failing:V1',
    locator:{method:changed.method,expression:changed.expression,runtimeRequired:false},
    expectation:'unique',
    deps:{confirm:confirmPageIdentity,
     probe:(page,locators)=>probePageLocators(page,locators,{includeNodeFingerprints:true}),
     summarize:captureDomSummary,
     wait:()=>delay(125),
    },
   });
  },
  restore:(hash)=>flow.restore({scriptId:'chrome-smoke-fixture',hash,approved:true,
   expectedCurrentHash:temporaryApplied.hash}),
 });
 assert.equal(autoGuard.status,'rolled-back-v1');
 assert.equal(autoGuard.functionalVerified,false);
 const activeAfterGuard=join(profile,'managed','chrome-smoke-fixture','current.user.js');
 assert.deepEqual(await readFile(activeAfterGuard),await readFile(applied.managedPath));

 assert.equal(await readFile(sourcePath,'utf8'),original);
 assert.match(await readFile(applied.managedPath,'utf8'),/#heal-button/);
 // One DOM selector being repaired is insufficient: this fixture requires BOTH.
 const partiallyRepairedBehavior=await runIsolatedFixtureBehavior({target:selected,fixtureUrl,
  source:await readFile(applied.managedPath,'utf8')});
 assert.equal(partiallyRepairedBehavior,false);
 const active=join(profile,'managed','chrome-smoke-fixture','current.user.js');
 assert.equal(await readFile(active,'utf8'),await readFile(applied.managedPath,'utf8'));
 // The second repair must build on the first one, rather than reloading the source.
 const originalScriptLine=original.split('\n')[4];
 assert.ok(originalScriptLine);
 const secondColumn=originalScriptLine.indexOf('document.querySelector(".old-target-pane")')+1;
 assert.ok(secondColumn>1);
 const nextProposal=await flow.propose({sourcePath,scriptId:'chrome-smoke-fixture',oldSelector:'.old-target-pane',newSelector:'.target-pane',
  selectorLocation:{method:'querySelector',line:5,column:secondColumn}});
 const nextReceipt=await flow.apply({proposalId:nextProposal.proposalId,approved:true});
 const combinedRevision=await readFile(active,'utf8');
 const repairedBehavior=await runIsolatedFixtureBehavior({target:selected,fixtureUrl,source:combinedRevision});
 assert.equal(repairedBehavior,true);
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
 const restoredBehavior=await runIsolatedFixtureBehavior({target:selected,fixtureUrl,source:await readFile(restored.activePath,'utf8')});
 assert.equal(restoredBehavior,false);
 // The fixture script creates a real about:srcdoc iframe. A top-level document
 // miss does not prove that a userscript which can run in frames is broken.
 await delay(400);
 const nestedIdentity=await confirmPageIdentity(selected);
 assert.ok((nestedIdentity.subframeCount??0)>=1,'real Chrome must report a nested iframe');
 const nestedContextDiagnosis=await diagnoseScriptsOnPage({
  items:[{path:'nested-fixture.user.js',scriptId:'nested-fixture',status:'parsed',
   analysis:fakeAnalysis('#iframe-only')}],
  target:selected,consent:true,deps:{confirm:confirmPageIdentity,probe:probePageLocators},
 });
 assert.equal(nestedContextDiagnosis.items[0]?.status,'needs-review',
  'a selector that is only in an iframe cannot be classified as broken from the top document');
 const topOnlyDiagnosis=await diagnoseScriptsOnPage({
  items:[{path:'top-only-fixture.user.js',scriptId:'top-only-fixture',status:'parsed',
   analysis:{...fakeAnalysis('#iframe-only'),metadata:{...scope,raw:{noframes:['']}}}}],
  target:selected,consent:true,deps:{confirm:confirmPageIdentity,probe:probePageLocators},
 });
 assert.equal(topOnlyDiagnosis.items[0]?.status,'locator-missing',
  '@noframes is defined as top-level only by Tampermonkey');
 await confirmPageIdentity(selected);
 console.log('PASS real Chrome CDP: page identity, 51-script batches, bulk candidates, synthetic behavior fail/repair-pass/rollback-fail, export.');
 console.log('Fixture-only browser DOM side effects verified. No Tampermonkey extension, GM_* API, or real userscript was executed.');
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
