/**
 * TEST-ONLY integration with the pinned official Violentmonkey MV3 release.
 * Runs one fixed userscript in a disposable CFT profile on a loopback page.
 * The result is fixture evidence only; product V4 remains not-configured.
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {access,lstat,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join,resolve,sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {
 assertChromeDebuggerPortFree,buildChromeLaunchArgs,getVerifiedChromeStatus,getChromeStatus,
} from '../packages/cdp-client/src/index.ts';
import {confirmPageIdentity} from '../packages/cdp-client/src/page-identity.ts';
import {readPinnedRegularFile} from '../packages/runtime-paths/src/pinned-file.ts';
import {mapPinnedOfficialFaultSite} from './violentmonkey-public-fault-ast.ts';
import {buildDirectChromeUserScriptRegistration,buildDirectChromeUserScriptRemoval,
 buildDirectChromeDefaultWorldRegistration,buildDirectChromeDefaultWorldRemoval,
 buildDirectChromeUserScriptListenerInstallation,buildDirectChromeUserScriptListenerRemoval,
 buildDirectChromeUserScriptListenerObservation,
} from './violentmonkey-direct-chrome-control.ts';
import {readVerifiedOfficialManagerCdpReply,readVerifiedDirectChromeControlValue} from './violentmonkey-cdp-transport-reply.ts';
import {waitForPinnedFixtureFrame} from './violentmonkey-frame-ready.ts';
import {createIsolatedFixtureFrameContextEvidence} from './violentmonkey-frame-context-evidence.ts';
import {createOfficialManagerScriptEvidence,createPinnedOfficialInjectorExceptionAttribution} from './violentmonkey-script-parse-evidence.ts';
import {createPinnedBootstrapMarkerEvidence,createPinnedIsolatedRuntimeExceptionEvidence} from './violentmonkey-bootstrap-marker-evidence.ts';
import {assertOfficialViolentmonkeyProcessRestart,classifyOfficialViolentmonkeyRestartBlocker,assertOfficialViolentmonkeyReleaseGate} from './violentmonkey-restart-attestation.ts';
import {inspectKnownUserscriptManagerTargets} from '../packages/cdp-client/src/manager-targets.ts';
import {
 assertViolentmonkeyInstallReceipt,assertViolentmonkeyV4FixtureObservation,extensionIdFromChromePublicKey,
 buildViolentmonkeyFixtureInstallExpression,buildViolentmonkeyFixturePreflightExpression,
 buildViolentmonkeyUserScriptsProbeExpression,buildViolentmonkeyUserScriptsAccessStatusExpression,
 buildViolentmonkeyUserScriptsAccessReasonExpression,buildViolentmonkeyUserScriptsCapabilityStatusExpression,
 readViolentmonkeyPreReloadAccess,buildViolentmonkeyProfileDeveloperModeExpression,
 enableViolentmonkeyUserScriptsAccess,
 buildViolentmonkeyFixtureRuntimeConfigurationExpression,
 buildViolentmonkeyManagerInjectionOptionsExpression,
 buildViolentmonkeyFixtureMatchExpression,
 buildViolentmonkeyFixtureRegistrationExpression,
 buildViolentmonkeyWorldConfigurationExpression,
 buildViolentmonkeyContentBridgeDiagnosticExpression,
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
async function openCdp(endpoint,onEvent){
 const socket=new WebSocket(endpoint);
 const pending=new Map();
 let sequence=0,closed=false;
 let scriptParsedObserver=null;
 let openedResolve,openedReject;
 const opened=new Promise((resolve,reject)=>{openedResolve=resolve;openedReject=reject;});
 socket.addEventListener('open',()=>openedResolve());
 socket.addEventListener('error',()=>openedReject(new Error('CDP WebSocket connection failed')));
 socket.addEventListener('message',event=>{
  let response;
  try{response=JSON.parse(typeof event.data==='string'?event.data:String(event.data));}
  catch{return;}
  if(response?.method==='Runtime.executionContextCreated'||
     response?.method==='Runtime.executionContextDestroyed'||
     response?.method==='Runtime.executionContextsCleared'||
     response?.method==='Runtime.exceptionThrown'){
   try{onEvent?.(response.method,response.params);}catch{}
   return;
  }
  if(response?.method==='Debugger.scriptParsed'){
   try{onEvent?.(response.method,response.params);}catch{}
   try{scriptParsedObserver?.(response.method,response.params);}catch{}
   return;
  }
  const task=pending.get(response.id);
  if(!task)return;
  pending.delete(response.id);clearTimeout(task.timer);
  try{task.resolve(readVerifiedOfficialManagerCdpReply(response));}
  catch{task.reject(new Error('CDP command failed'));}
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
  watchScriptParsed(observer){
   if(observer!==null&&typeof observer!=='function')throw new Error('Invalid isolated debugger observer');
   scriptParsedObserver=observer;
  },
  close(){scriptParsedObserver=null;try{socket.close();}catch{}}
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

/**
 * RG-05 read-only official SW option receipt, before and after restart.
 * A retained script is insufficient if its global injection mode differs.
 */
async function readManagerInjectionOptions(cdp,hasExited){
 if(hasExited())throw new Error('RG-05 isolated Chrome exited before official manager options inspection');
 let value;
 try{
  const result=await cdp.send('Runtime.evaluate',{
   expression:buildViolentmonkeyManagerInjectionOptionsExpression(),
   awaitPromise:true,returnByValue:true,
  });
  if(result.exceptionDetails||result.result?.exceptionDetails)
   throw new Error('unexpected evaluation');
  value=result.result?.value;
 }catch{throw new Error('RG-05 official manager injection options inspection failed');}
 if(typeof value!=='string'||value.length>160)
  throw new Error('RG-05 official manager injection options receipt invalid');
 let parsed;
 try{parsed=JSON.parse(value);}catch{throw new Error('RG-05 official manager injection options receipt invalid');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
    Object.keys(parsed).sort().join(',')!=='applied,fastInject,xhrInject'||
    !Object.values(parsed).every(v=>typeof v==='boolean'))
  throw new Error('RG-05 official manager injection options receipt invalid');
 if(!parsed.applied)throw new Error('RG-05 official manager injection disabled');
 if(hasExited())throw new Error('RG-05 isolated Chrome exited during official manager options inspection');
 return parsed;
}

/** Exact official manager read-only URL matching, not an injection command. */
async function readManagerFixtureMatch(cdp,fixtureUrl,scriptId,hasExited){
 if(hasExited())throw new Error('RG-05 fixture manager matcher Chrome exited');
 let text;
 try{
  const response=await cdp.send('Runtime.evaluate',{
   expression:buildViolentmonkeyFixtureMatchExpression(fixtureUrl,scriptId),
   awaitPromise:true,returnByValue:true,
  });
  if(response.exceptionDetails||response.result?.exceptionDetails)
   throw new Error('evaluation failed');
  text=response.result?.value;
 }catch{throw new Error('RG-05 official manager fixture matcher inspection failed');}
 if(typeof text!=='string'||text.length>80)
  throw new Error('RG-05 official manager fixture matcher receipt invalid');
 let result;
 try{result=JSON.parse(text);}
 catch{throw new Error('RG-05 official manager fixture matcher receipt invalid');}
 if(!result||typeof result!=='object'||Array.isArray(result)||
    Object.keys(result).length!==1||typeof result.matched!=='boolean')
  throw new Error('RG-05 official manager fixture matcher receipt invalid');
 if(hasExited())throw new Error('RG-05 fixture manager matcher Chrome exited');
 return {matched:result.matched};
}

/** Four bounded read-only booleans from Chrome's official userScripts registry. */
async function readManagerFixtureRegistration(cdp,fixtureUrl,hasExited){
 if(hasExited())throw new Error('RG-05 registration diagnostic Chrome exited');
 let value;
 try{
  const answer=await cdp.send('Runtime.evaluate',{
   expression:buildViolentmonkeyFixtureRegistrationExpression(fixtureUrl),
   awaitPromise:true,returnByValue:true,
  });
  if(answer.exceptionDetails||answer.result?.exceptionDetails)
   throw new Error('unexpected diagnostic exception');
  value=answer.result?.value;
 }catch{throw new Error('RG-05 official registration diagnostic failed');}
 if(typeof value!=='string'||value.length>160)
  throw new Error('RG-05 official registration receipt invalid');
 let receipt;
 try{receipt=JSON.parse(value);}catch{throw new Error('RG-05 official registration receipt invalid');}
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
    Object.keys(receipt).sort().join(',')!==
     'baseMatchesFixture,baseRegistered,dataMatchesFixture,fixtureDataRegistered'||
    !Object.values(receipt).every(v=>typeof v==='boolean'))
  throw new Error('RG-05 official registration receipt invalid');
 if(hasExited())throw new Error('RG-05 registration diagnostic Chrome exited');
 return receipt;
}


/** Official Chrome world state only: bounded boolean projection, not GM proof. */
async function readManagerWorldConfiguration(cdp,hasExited){
 if(hasExited())throw new Error('RG-05 world configuration diagnostic Chrome exited');
 let value;
 try{
  const response=await cdp.send('Runtime.evaluate',{
   expression:buildViolentmonkeyWorldConfigurationExpression(),
   awaitPromise:true,returnByValue:true,
  });
  if(response.exceptionDetails||response.result?.exceptionDetails)
   throw new Error('invalid world diagnostic');
  value=response.result?.value;
 }catch{throw new Error('RG-05 official world configuration diagnostic failed');}
 if(typeof value!=='string'||value.length>160)
  throw new Error('RG-05 official world configuration receipt invalid');
 let result;
 try{result=JSON.parse(value);}
 catch{throw new Error('RG-05 official world configuration receipt invalid');}
 if(!result||typeof result!=='object'||Array.isArray(result)||
    Object.keys(result).sort().join(',')!==
     'defaultWorldConfigured,expectedCsp,messagingEnabled'||
    !Object.values(result).every(v=>typeof v==='boolean'))
  throw new Error('RG-05 official world configuration receipt invalid');
 if(hasExited())throw new Error('RG-05 world configuration diagnostic Chrome exited');
 return result;
}

/** Diagnostic only after TWO missing real GM receipts, not an injection prewarm. */
async function readOfficialContentBridgeDiagnostic(cdp,fixtureUrl,hasExited){
 if(hasExited())throw new Error('RG-05 bridge diagnostic browser exited');
 let value;
 try{
  const answer=await cdp.send('Runtime.evaluate',{
   expression:buildViolentmonkeyContentBridgeDiagnosticExpression(fixtureUrl),
   awaitPromise:true,returnByValue:true,
  });
  if(answer.exceptionDetails||answer.result?.exceptionDetails)throw Error('invalid');
  value=answer.result?.value;
 }catch{throw new Error('RG-05 official bridge diagnostic transport failed');}
 if(typeof value!=='string'||value.length>120)
  throw new Error('RG-05 official bridge diagnostic receipt invalid');
 let receipt;
 try{receipt=JSON.parse(value);}catch{throw new Error('RG-05 official bridge diagnostic receipt invalid');}
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
    Object.keys(receipt).sort().join(',')!=='bridgeResponded,targetFound'||
    typeof receipt.bridgeResponded!=='boolean'||typeof receipt.targetFound!=='boolean'||
    (receipt.bridgeResponded&&!receipt.targetFound))
  throw new Error('RG-05 official bridge diagnostic receipt invalid');
 if(hasExited())throw new Error('RG-05 bridge diagnostic browser exited');
 return receipt;
}

/** Parse-only CDP inventory of two EXACT official injector assets in the
 * already pinned disposable page, never a GM/V4 or successful run receipt.
 * Run only AFTER genuine GM control receipts or AFTER both failed documents;
 * enabling Debugger before cold navigation could perturb startup timing. */
const UNAVAILABLE_PRE_RELOAD_ACCESS=Object.freeze({
 observed:false,matched:false,enabled:false,active:false,reason:'unavailable',
 profileDeveloperMode:'unavailable',
});

/**
 * Examine only the disposable CFT profile after confirmed cold-start GM
 * failures. No extension settings are changed; the new WebUI tab is closed.
 */
async function collectPreReloadViolentmonkeyAccess({browserCdp,hasExited}){
 let settingsCdp,targetId;
 try{
  if(hasExited())return UNAVAILABLE_PRE_RELOAD_ACCESS;
  const url='chrome://extensions/';
  const created=await browserCdp.send('Target.createTarget',{url});
  targetId=created?.targetId;
  if(typeof targetId!=='string'||!targetId)return UNAVAILABLE_PRE_RELOAD_ACCESS;
  const page=await waitForPage(targetId,url,hasExited);
  settingsCdp=await openCdp(page.webSocketDebuggerUrl);
  await settingsCdp.send('Runtime.enable');
  for(let attempt=0;attempt<8&&!hasExited();attempt++){
   const receipt=await readViolentmonkeyPreReloadAccess(
    (method,params)=>settingsCdp.send(method,params));
   if(receipt.observed&&receipt.reason!=='page-context'&&
      receipt.reason!=='settings-api'){
     let profileDeveloperMode='unavailable';
     try{
      const answer=await settingsCdp.send('Runtime.evaluate',{
       expression:buildViolentmonkeyProfileDeveloperModeExpression(),
       awaitPromise:true,returnByValue:true,
      });
      if(answer&&typeof answer==='object'&&
         !Object.hasOwn(answer,'error')&&!Object.hasOwn(answer,'exceptionDetails')&&
         answer.result&&typeof answer.result==='object'&&
         !Object.hasOwn(answer.result,'error')&&
         !Object.hasOwn(answer.result,'exceptionDetails')&&
         ['enabled','disabled'].includes(answer.result.value))
       profileDeveloperMode=answer.result.value;
     }catch{/* Fixed unavailable status; never surface raw Chrome errors. */}
     return Object.freeze({...receipt,profileDeveloperMode});
    }
   if(attempt<7)await delay(125);
  }
  return UNAVAILABLE_PRE_RELOAD_ACCESS;
 }catch{
  // No raw Chrome/CDP exception contents or extension metadata can escape.
  return UNAVAILABLE_PRE_RELOAD_ACCESS;
 }finally{
  settingsCdp?.close();
  if(targetId){
   try{await browserCdp.send('Target.closeTarget',{targetId});}catch{}
  }
 }
}

/**
 * RG-05 POST-BLOCKER ONLY: distinguish direct Chrome USER_SCRIPT runtime
 * support from Violentmonkey's content bridge after a genuine failed restart.
 * Register a fixed synthetic script from the pinned options page, observe a
 * different disposable loopback document, and unregister the exact fixture ID.
 * The result cannot satisfy any manager GM, FR-026 or Stable release gate.
 */
async function runDirectChromeUserScriptDiagnostic({
 browserCdp,optionsCdp,controlUrl,hasExited,world='dedicated',
}){
 if(world!=='dedicated'&&world!=='default')throw new Error('Unsupported isolated Chrome world differential');
 let targetId,pageCdp,registered=false,cleanupVerified=false;
 let listenerAttached=false,listenerRemoved=false;
 let marker='not-observed',roundtrip='unavailable';
 let messageReceipt=Object.freeze({received:false,sourceMatched:false,replied:false});
 const markers=['none','send-only','onmessage-only','send-onmessage','unavailable'];
 try{
  if(hasExited())return {registered:false,marker,roundtrip,messageReceipt,listenerRemoved:false,cleanupVerified:false};
  const receipt=await optionsCdp.send('Runtime.evaluate',{
   expression:world==='default'?buildDirectChromeDefaultWorldRegistration(controlUrl):
    buildDirectChromeUserScriptRegistration(controlUrl),
   awaitPromise:true,returnByValue:true,
  });
  if(readVerifiedDirectChromeControlValue(receipt)!=='registered')
   return {registered:false,marker,cleanupVerified:false};
  registered=true;
  // The response listener lives only in this disposable options page and is
  // attached before creating a new synthetic document. A failed attach must
  // not turn missing messaging into a false positive.
  try{
   const listener=await optionsCdp.send('Runtime.evaluate',{
    expression:buildDirectChromeUserScriptListenerInstallation(controlUrl),
    returnByValue:true,
   });
   listenerAttached=readVerifiedDirectChromeControlValue(listener)==='attached';
   if(listenerAttached)roundtrip='missing';
  }catch{}
  const created=await browserCdp.send('Target.createTarget',{url:controlUrl});
  targetId=created?.targetId;
  if(typeof targetId!=='string'||!targetId)
   throw new Error('Direct Chrome diagnostic target was not created');
  const page=await waitForPage(targetId,controlUrl,hasExited);
  const identity=await confirmPageIdentity(page);
  if(identity.confirmedUrl!==controlUrl||!identity.frameId||!identity.loaderId)
   throw new Error('Direct Chrome diagnostic identity missing');
  pageCdp=await openCdp(page.webSocketDebuggerUrl);
  await pageCdp.send('Runtime.enable');
  for(let attempt=0;attempt<24&&!hasExited();attempt++){
   const before=await pageCdp.send('Page.getFrameTree');
   const pinned=before?.frameTree?.frame;
   if(pinned?.id!==identity.frameId||pinned?.loaderId!==identity.loaderId||
      pinned?.url!==controlUrl)throw new Error('Direct Chrome diagnostic document changed');
   const value=await pageCdp.send('Runtime.evaluate',{
    expression:"document.documentElement?.getAttribute('data-usshm-rg05-direct-control') ?? null",
    returnByValue:true,
   });
   const after=await pageCdp.send('Page.getFrameTree');
   const current=after?.frameTree?.frame;
   if(current?.id!==identity.frameId||current?.loaderId!==identity.loaderId||
      current?.url!==controlUrl)throw new Error('Direct Chrome diagnostic document changed');
   const observedMarker=readVerifiedDirectChromeControlValue(value);
   if(markers.includes(observedMarker))marker=observedMarker;
   // API presence alone was the old control. A true USER_SCRIPT -> extension
   // onUserScriptMessage -> USER_SCRIPT reply proves actual messaging in this
   // post-blocker disposable fixture, and never substitutes for official GM.
   const response=await pageCdp.send('Runtime.evaluate',{
    expression:"document.documentElement?.getAttribute('data-usshm-rg05-direct-roundtrip') ?? null",
    returnByValue:true,
   });
   const final=await pageCdp.send('Page.getFrameTree');
   const afterReply=final?.frameTree?.frame;
   if(afterReply?.id!==identity.frameId||afterReply?.loaderId!==identity.loaderId||
      afterReply?.url!==controlUrl)
    throw new Error('Direct Chrome messaging document or receipt changed');
   const observedReply=readVerifiedDirectChromeControlValue(response);
   if(listenerAttached&&observedReply==='verified'){
    roundtrip='verified';
    break;
   }
   if(marker!=='not-observed'&&!listenerAttached)break;
   if(attempt<23)await delay(200);
  }
 }catch{
  // Chrome/extension exceptions are untrusted: only the fixed status escapes.
 }finally{
  pageCdp?.close();
  if(targetId){
   try{await browserCdp.send('Target.closeTarget',{targetId});}catch{}
  }
  if(listenerAttached){
   // Read strictly bounded receipt BEFORE detaching the exact listener.
   // Never print message contents, sender IDs, URLs or extension metadata.
   try{
    const snapshot=await optionsCdp.send('Runtime.evaluate',{
     expression:buildDirectChromeUserScriptListenerObservation(),
     returnByValue:true,
    });
    if(snapshot&&!Object.hasOwn(snapshot,'error')&&
       !Object.hasOwn(snapshot,'exceptionDetails')){
     const raw=readVerifiedDirectChromeControlValue(snapshot);
     if(typeof raw==='string'&&raw.length<128){
      const parsed=JSON.parse(raw);
      if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&
         Object.keys(parsed).sort().join(',')==='received,replied,sourceMatched'&&
         typeof parsed.received==='boolean'&&
         typeof parsed.sourceMatched==='boolean'&&
         typeof parsed.replied==='boolean'&&
         (!parsed.replied||parsed.sourceMatched)&&
         (!parsed.sourceMatched||parsed.received)){
       messageReceipt=Object.freeze({
        received:parsed.received,sourceMatched:parsed.sourceMatched,replied:parsed.replied,
       });
      }
     }
    }
   }catch{}
   try{
    const removed=await optionsCdp.send('Runtime.evaluate',{
     expression:buildDirectChromeUserScriptListenerRemoval(),
     returnByValue:true,
    });
    listenerRemoved=readVerifiedDirectChromeControlValue(removed)==='removed';
   }catch{}
  }
  if(registered){
   try{
    const removed=await optionsCdp.send('Runtime.evaluate',{
     expression:world==='default'?buildDirectChromeDefaultWorldRemoval():
      buildDirectChromeUserScriptRemoval(),
     awaitPromise:true,returnByValue:true,
    });
    cleanupVerified=readVerifiedDirectChromeControlValue(removed)==='removed';
   }catch{}
  }
 }
 return {registered,marker,roundtrip,messageReceipt,listenerRemoved,cleanupVerified};
}

const POST_BLOCKER_RELOAD_STAGES=Object.freeze([
 'reload-request','reload-issued','options-ready','capability-ready',
 'injector-ready','script-retained','fixture-ready','gm-observed','recovered',
 'reload-skipped-unsafe-profile',
]);

async function runPostBlockerExtensionReloadDiagnostic({
 browserCdp,optionsCdp,fixtureUrl,optionsUrl,hasExited,allowReload=false,
}){
 let diagnosticOptionsCdp,diagnosticPageCdp,diagnosticSettingsCdp;
 let optionsTargetId,fixtureTargetId,settingsTargetId;
 let stage='reload-request';
 let accessStatus=Object.freeze({matched:false,enabled:false,active:false});
 let accessReason='not-sampled';
 let capabilityStatus=Object.freeze({apiPresent:false,querySucceeded:false});
 const result=fixture=>Object.freeze({
  stage,fixture:fixture??null,accessStatus,accessReason,capabilityStatus,
 });
 try{
  if(!allowReload){stage='reload-skipped-unsafe-profile';return result(null);}
  if(hasExited())return result(null);
  const reloadExpression=`(()=>{try{
   if(location.href!==${JSON.stringify(optionsUrl)}||
      chrome.runtime?.id!==${JSON.stringify(extensionId)})return false;
   setTimeout(()=>{try{chrome.runtime.reload();}catch{}},0);
   return true;
  }catch{return false;}})()`;
  const issued=await optionsCdp.send('Runtime.evaluate',{
   expression:reloadExpression,returnByValue:true,
  });
  if(issued?.result?.value!==true)return result(null);
  stage='reload-issued';
  // The scheduled reload must have time to invalidate the old extension
  // contexts before a fresh pinned options target is created.
  await delay(750);
  if(hasExited())return result(null);

  const createdOptions=await browserCdp.send('Target.createTarget',{url:optionsUrl});
  optionsTargetId=createdOptions?.targetId;
  if(typeof optionsTargetId!=='string'||!optionsTargetId)return result(null);
  const optionsPage=await waitForPage(optionsTargetId,optionsUrl,hasExited);
  diagnosticOptionsCdp=await openCdp(optionsPage.webSocketDebuggerUrl);
  await diagnosticOptionsCdp.send('Runtime.enable');
  stage='options-ready';

  // Passive Chrome settings snapshot only. It is deliberately isolated from
  // the capability path so a late chrome://extensions context cannot alter
  // the already-classified blocker or prevent the real options-page probe.
  try{
   const settingsUrl='chrome://extensions/';
   const createdSettings=await browserCdp.send('Target.createTarget',{url:settingsUrl});
   settingsTargetId=createdSettings?.targetId;
   if(typeof settingsTargetId==='string'&&settingsTargetId){
    const settingsPage=await waitForPage(settingsTargetId,settingsUrl,hasExited);
    diagnosticSettingsCdp=await openCdp(settingsPage.webSocketDebuggerUrl);
    await diagnosticSettingsCdp.send('Runtime.enable');
    for(let attempt=0;attempt<12&&!hasExited();attempt++){
     const answer=await diagnosticSettingsCdp.send('Runtime.evaluate',{
      expression:buildViolentmonkeyUserScriptsAccessStatusExpression(),
      awaitPromise:true,returnByValue:true,
     });
     const text=answer?.result?.value;
     let matched=false;
     if(typeof text==='string'&&text.length<=96){
      try{
       const parsed=JSON.parse(text);
       const valid=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&
        Object.keys(parsed).sort().join(',')==='active,enabled,matched'&&
        typeof parsed.matched==='boolean'&&typeof parsed.enabled==='boolean'&&
        typeof parsed.active==='boolean'&&(!parsed.active||parsed.enabled)&&
        (!parsed.enabled||parsed.matched);
       if(valid){
        accessStatus=Object.freeze({
         matched:parsed.matched,enabled:parsed.enabled,active:parsed.active,
        });
        matched=parsed.matched;
       }
      }catch{}
     }
     try{
      const reasonAnswer=await diagnosticSettingsCdp.send('Runtime.evaluate',{
       expression:buildViolentmonkeyUserScriptsAccessReasonExpression(),
       awaitPromise:true,returnByValue:true,
      });
      const reasonText=reasonAnswer?.result?.value;
      if(typeof reasonText==='string'&&reasonText.length<=64){
       const parsed=JSON.parse(reasonText);
       const allowed=new Set([
        'page-context','settings-api','settings-error','identity','version',
        'state-disabled-reloading','state-disabled-unsupported-developer',
        'state-disabled-unsupported-manifest','state-disabled-corrupt',
        'state-disabled-suspicious','state-disabled-update','state-disabled-store',
        'state-disabled-policy','state-disabled-custodian','state-disabled-parent',
        'state-disabled-other-extension','state-disabled-none',
        'state-disabled-multiple',
        'state-terminated','state-blocklisted','state-other',
        'installation','toggle-disabled','toggle-inactive','active',
       ]);
       if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&
          Object.keys(parsed).join(',')==='reason'&&allowed.has(parsed.reason)){
        accessReason=parsed.reason;
       }
      }
     }catch{}
     if(matched)break;
     if(attempt<11)await delay(100);
    }
    diagnosticSettingsCdp.close();diagnosticSettingsCdp=undefined;
    try{await browserCdp.send('Target.closeTarget',{targetId:settingsTargetId});}catch{}
    settingsTargetId=undefined;
   }
  }catch{
   // Keep the fixed all-false snapshot. Never surface developerPrivate errors.
  }

  const capability=await diagnosticOptionsCdp.send('Runtime.evaluate',{
   expression:buildViolentmonkeyUserScriptsCapabilityStatusExpression(),
   awaitPromise:true,returnByValue:true,
  });
  const capabilityText=capability?.result?.value;
  if(typeof capabilityText==='string'&&capabilityText.length<=96){
   try{
    const parsed=JSON.parse(capabilityText);
    const valid=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&
     Object.keys(parsed).sort().join(',')==='apiPresent,querySucceeded'&&
     typeof parsed.apiPresent==='boolean'&&typeof parsed.querySucceeded==='boolean'&&
     (!parsed.querySucceeded||parsed.apiPresent);
    if(valid)capabilityStatus=Object.freeze({
     apiPresent:parsed.apiPresent,querySucceeded:parsed.querySucceeded,
    });
   }catch{}
  }
  if(capabilityStatus.querySucceeded!==true)return result(null);
  stage='capability-ready';

  await waitForVerifiedViolentmonkeyInjector({
   send:(method,params)=>diagnosticOptionsCdp.send(method,params),
   hasExited,
  });
  stage='injector-ready';

  const retained=await readManagerPreflight(diagnosticOptionsCdp,hasExited);
  if(retained.found!==true)return result(null);
  stage='script-retained';

  const diagnosticFixtureTarget=await browserCdp.send('Target.createTarget',{url:fixtureUrl});
  fixtureTargetId=diagnosticFixtureTarget?.targetId;
  if(typeof fixtureTargetId!=='string'||!fixtureTargetId)return result(null);
  const fixturePage=await waitForPage(fixtureTargetId,fixtureUrl,hasExited);
  const identity=await waitForPinnedFixtureFrame({
   expectedUrl:fixtureUrl,inspect:()=>confirmPageIdentity(fixturePage),
   hasExited,pause:()=>delay(250),
  });
  diagnosticPageCdp=await openCdp(fixturePage.webSocketDebuggerUrl);
  await diagnosticPageCdp.send('Runtime.enable');
  await diagnosticPageCdp.send('Page.enable');
  stage='fixture-ready';

  const fixture=await readViolentmonkeyFixtureObservation({
   send:diagnosticPageCdp.send,frameId:identity.frameId,url:fixtureUrl,hasExited,
  });
  stage='gm-observed';
  return result(fixture);
 }catch{
  // Diagnostic failure must never hide or replace the already-classified
  // cold-start release blocker, and raw CDP/extension errors stay private.
  return result(null);
 }finally{
  diagnosticPageCdp?.close();
  diagnosticOptionsCdp?.close();
  diagnosticSettingsCdp?.close();
  if(typeof fixtureTargetId==='string'){
   try{await browserCdp.send('Target.closeTarget',{targetId:fixtureTargetId});}catch{}
  }
  if(typeof optionsTargetId==='string'){
   try{await browserCdp.send('Target.closeTarget',{targetId:optionsTargetId});}catch{}
  }
  if(typeof settingsTargetId==='string'){
   try{await browserCdp.send('Target.closeTarget',{targetId:settingsTargetId});}catch{}
  }
 }
}

async function collectOfficialManagerScriptEvidence(cdp,frameId,hasExited){
 if(hasExited())throw new Error('RG-05 pinned debugger target already exited');
 const evidence=createOfficialManagerScriptEvidence(frameId,extensionId);
 cdp.watchScriptParsed(evidence.observe);
 try{
  await cdp.send('Debugger.enable');
  // Debugger.scriptParsed replays known scripts on enable. Allow a bounded
  // event delivery interval; never read source or private script identifiers.
  await delay(100);
  if(hasExited())throw new Error('RG-05 pinned debugger target exited during observation');
  return evidence.snapshot();
 }finally{
  try{await cdp.send('Debugger.disable');}finally{cdp.watchScriptParsed(null);}
 }
}

const profile=await mkdtemp(join(tmpdir(),'usshm-vm-v4-profile-'));
const requests=[];
const server=createServer((request,response)=>{
 if(request.method==='GET'&&request.url==='/fixture'){
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  response.end('<!doctype html><html><head><title>USSHM VM fixture</title></head><body><main id="usshm-vm-fixture">Local synthetic manager fixture</main></body></html>');
  return;
 }
 if(request.method==='GET'&&request.url==='/rg05-direct-control'){
  // Separate synthetic document: the pinned manager fixture only matches /fixture.
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  response.end('<!doctype html><html><head><title>RG-05 direct Chrome control</title></head><body><main>Isolated direct USER_SCRIPT control</main></body></html>');
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
 const directControlUrl=`http://127.0.0.1:${address.port}/rg05-direct-control`;
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
 const beforeRestartOptions=await readManagerInjectionOptions(optionsCdp,()=>exited);
 const beforeWorld=await readManagerWorldConfiguration(optionsCdp,()=>exited);
 console.log('RG-05 official Chrome USER_SCRIPT world before first fixture: '+JSON.stringify(beforeWorld));
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
 const verifiedInstall=assertViolentmonkeyInstallReceipt(installReceipt,preflightReceipt.found===false);
 // ParseScript exercises the real official manager and wakes its MV3 worker;
 // the app's read-only target inventory is intentionally passive and may not
 // report a sleeping worker before this bounded fixture interaction.
 const managerReport=await inspectKnownUserscriptManagerTargets({
  approved:true,browserEndpoint:status.browserSocket,expectedProduct:status.browser,port:9223,
 });
 assert.ok(managerReport.observed.includes('violentmonkey'));
 assert.equal(managerReport.V4,'not-configured');
 assert.equal(managerReport.managerVerified,false);
 const firstMatch=await readManagerFixtureMatch(optionsCdp,fixtureUrl,verifiedInstall.scriptId,()=>exited);
 if(!firstMatch.matched)throw new Error('RG-05 official manager fixture matcher did not match before first injection');
 console.log('RG-05 official manager fixture matcher: initial fixed URL matched.');
  const beforeFirstRegistration=await readManagerFixtureRegistration(optionsCdp,fixtureUrl,()=>exited);
  console.log('RG-05 official Chrome registration before initial fixture: '+JSON.stringify(beforeFirstRegistration));
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
 const initialContextEvidence=createIsolatedFixtureFrameContextEvidence(identity.frameId);
 const initialMarkerEvidence=createPinnedBootstrapMarkerEvidence(identity.frameId);
 const initialRuntimeExceptions=createPinnedIsolatedRuntimeExceptionEvidence(identity.frameId);
 const initialInjectorExceptions=createPinnedOfficialInjectorExceptionAttribution(identity.frameId,extensionId);
 pageCdp=await openCdp(fixturePage.webSocketDebuggerUrl,(method,params)=>{
  initialContextEvidence.observe(method,params);
  initialMarkerEvidence.observe(method,params);
  initialRuntimeExceptions.observe(method,params);
  initialInjectorExceptions.observe(method,params);
 });
 await pageCdp.send('Runtime.enable');
 await pageCdp.send('Debugger.enable');
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
 console.log('RG-05 initial fixture CDP contexts: '+JSON.stringify(initialContextEvidence.snapshot())+'; not manager verification.');
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
 // RG-05 PRE-RESTART diagnostic control. Two actual official GM receipts
 // established a working manager BEFORE we sample Chrome's existing default
 // USER_SCRIPT world. This temporary exact-loopback script is not a GM
 // replacement and must never modify the manager's default world settings.
 const baselineDefaultWorld=await runDirectChromeUserScriptDiagnostic({
  browserCdp,optionsCdp,controlUrl:directControlUrl,hasExited:()=>exited,
  world:'default',
 });
 console.log('RG-05 default USER_SCRIPT before Chrome process restart: '+
  JSON.stringify(baselineDefaultWorld)+'; diagnostic only, not a GM receipt or V4 proof.');
 // Never proceed into a cold-start comparison if a registered disposable
 // synthetic script or its response listener was not demonstrably removed.
 if(baselineDefaultWorld.registered===true&&
    (baselineDefaultWorld.cleanupVerified!==true||
     baselineDefaultWorld.listenerRemoved!==true))
  throw new Error('RG-05 baseline synthetic control cleanup was not verified');
 // This is a control sample only after TWO independently validated real GM
 // receipts in the original process. Without a known working control we
 // cannot claim that a false restarted response identifies the failing layer.
 try{
  const bridgeControl=await readOfficialContentBridgeDiagnostic(optionsCdp,fixtureUrl,()=>exited);
  console.log('RG-05 official content bridge control after two REAL GM receipts: '+JSON.stringify(bridgeControl)+'; not product V4 proof.');
 }catch{
  console.log('RG-05 official content bridge control unavailable; after-restart absence remains inconclusive.');
 }

 // Observe parsed official injector *files*, not content or execution.
 // A missing parse event is inconclusive about why the manager is not responding.
 try{
  const baselineParsed=await collectOfficialManagerScriptEvidence(pageCdp,identity.frameId,()=>exited);
  console.log('RG-05 official injector parsed scripts control: '+JSON.stringify(baselineParsed)+'; not GM execution proof.');
 }catch{
  console.log('RG-05 official injector parsed scripts control unavailable; no V4 inference.');
 }
 // Pinned official v2.49.0 bootstrap's fixed own-property marker is an
 // observation of partial code execution, NOT of GM or content bridge health.
 // Only inspect after both real original-process GM receipts.
 try{
  const controlMarker=await initialMarkerEvidence.read((method,params)=>pageCdp.send(method,params));
  console.log('RG-05 official VM bootstrap marker control: '+JSON.stringify(controlMarker)+'; not GM proof.');
 }catch{
  console.log('RG-05 official VM bootstrap marker control unavailable; no V4 inference.');
 }
 console.log('RG-05 isolated runtime exceptions control after genuine GM receipts: '+
  JSON.stringify(initialRuntimeExceptions.snapshot())+'; no script attribution.');
 console.log('RG-05 official injector exception attribution control after genuine GM receipts: '+
  JSON.stringify(initialInjectorExceptions.snapshot())+'; no private error data.');
 console.log('RG-05 official injected.js error class control: '+
  initialInjectorExceptions.injectedExceptionClass()+'; allowlisted class only.');
 console.log('RG-05 official injected.js failure signature control: '+
  initialInjectorExceptions.injectedFailureSignature()+'; fixed upstream signature only.');
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
 // The name/namespace alone does not prove persisted @match/GM activation.
 // Keep the source and complete inventory inside the official manager.
 const auditResponse=await optionsCdp.send('Runtime.evaluate',{
  expression:buildViolentmonkeyFixtureRuntimeConfigurationExpression(
   fixtureMeta.name,fixtureMeta.namespace,fixtureUrl),
  awaitPromise:true,returnByValue:true,
 });
 const auditText=auditResponse.result?.value;
 if(typeof auditText!=='string'||auditText.length>256)
  throw new Error('RG-05 persisted manager configuration receipt invalid');
 let persistedConfig;
 try{persistedConfig=JSON.parse(auditText);}
 catch{throw new Error('RG-05 persisted manager configuration receipt invalid');}
 if(!persistedConfig||typeof persistedConfig!=='object'||Array.isArray(persistedConfig)||
    Object.keys(persistedConfig).sort().join(',')!=='enabled,gmGrants,present,scope'||
    !['present','enabled','scope','gmGrants'].every(key=>typeof persistedConfig[key]==='boolean'))
  throw new Error('RG-05 persisted manager configuration receipt invalid');
 if(!(persistedConfig.present===true&&persistedConfig.enabled===true&&
      persistedConfig.scope===true&&persistedConfig.gmGrants===true))
  throw new Error('RG-05 persisted manager script exists but cannot prove enabled scope and GM grants');
 console.log('RG-05 official manager persisted fixture config verified: enabled, exact scope, four GM grants (no source exported).');
 const resumedManagers=await inspectKnownUserscriptManagerTargets({
  approved:true,browserEndpoint:status.browserSocket,expectedProduct:status.browser,port:9223,
 });
 if(!resumedManagers.observed.includes('violentmonkey')||
    resumedManagers.V4!=='not-configured'||resumedManagers.managerVerified!==false)
  throw new Error('Official manager target missing after process restart');
 const afterRestartOptions=await readManagerInjectionOptions(optionsCdp,()=>exited);
 const afterWorld=await readManagerWorldConfiguration(optionsCdp,()=>exited);
 console.log('RG-05 official Chrome USER_SCRIPT world after Chrome restart: '+JSON.stringify(afterWorld));
 if(JSON.stringify(afterRestartOptions)!==JSON.stringify(beforeRestartOptions))
  throw new Error('RG-05 official manager options differ after restart');
 console.log('RG-05 official manager injection options retained after process restart (bounded booleans).');
 const resumedMatch=await readManagerFixtureMatch(optionsCdp,fixtureUrl,verifiedInstall.scriptId,()=>exited);
 if(!resumedMatch.matched)throw new Error('RG-05 official manager fixture matcher did not match after Chrome restart');
 console.log('RG-05 official manager fixture matcher: restarted fixed URL matched.');
  const afterRestartRegistration=await readManagerFixtureRegistration(optionsCdp,fixtureUrl,()=>exited);
  console.log('RG-05 official Chrome registration before restarted fixture: '+JSON.stringify(afterRestartRegistration));
 const createdRestartFixture=await browserCdp.send('Target.createTarget',{url:fixtureUrl});
 if(typeof createdRestartFixture.targetId!=='string'||!createdRestartFixture.targetId)
  throw new Error('Restarted Chrome could not create isolated fixture');
 const restartedFixturePage=await waitForPage(createdRestartFixture.targetId,fixtureUrl,()=>exited);
 const afterRestartIdentity=await waitForPinnedFixtureFrame({
  expectedUrl:fixtureUrl,inspect:()=>confirmPageIdentity(restartedFixturePage),
  hasExited:()=>exited,pause:()=>delay(250),
 });
 const restartedContextEvidence=createIsolatedFixtureFrameContextEvidence(afterRestartIdentity.frameId);
 const restartedMarkerEvidence=createPinnedBootstrapMarkerEvidence(afterRestartIdentity.frameId);
 const restartedRuntimeExceptions=createPinnedIsolatedRuntimeExceptionEvidence(afterRestartIdentity.frameId);
 const restartedInjectorExceptions=createPinnedOfficialInjectorExceptionAttribution(afterRestartIdentity.frameId,extensionId);
 pageCdp=await openCdp(restartedFixturePage.webSocketDebuggerUrl,(method,params)=>{
  restartedContextEvidence.observe(method,params);
  restartedMarkerEvidence.observe(method,params);
  restartedRuntimeExceptions.observe(method,params);
  restartedInjectorExceptions.observe(method,params);
 });
 await pageCdp.send('Runtime.enable');
 await pageCdp.send('Debugger.enable');
 await pageCdp.send('Page.enable');
 console.log('RG-05 fixed stage: process-restart');
 let third;
 let startupWarmup=false;
 let startupInjectionBlocked=false;
 try{
  third=await readViolentmonkeyFixtureObservation({
   send:pageCdp.send,frameId:afterRestartIdentity.frameId,url:fixtureUrl,hasExited:()=>exited,
  });
  console.log('RG-05 restarted fixture CDP contexts: '+JSON.stringify(restartedContextEvidence.snapshot())+'; not manager verification.');
 }catch(error){
  console.log('RG-05 restarted fixture CDP contexts: '+JSON.stringify(restartedContextEvidence.snapshot())+'; not manager verification.');
  // Official MV3 can show a registered manager yet miss FIRST cold-start
  // injection. Report that fact truthfully, never treat inventory as V4 pass.
  // Retry ONLY a no-marker cold start with zero additional GM requests, using
  // one explicitly isolated localhost reload and a NEW document loader.
  if(!(error instanceof Error)||
     error.message!=='Pinned Violentmonkey fixture did not publish its bounded GM API result; stage: not-observed'||
     requests.length!==2)throw error;
  const prior=await pageCdp.send('Page.getFrameTree');
  const pinned=prior.frameTree?.frame;
  if(pinned?.id!==afterRestartIdentity.frameId||
     pinned?.url!==fixtureUrl||pinned?.loaderId!==afterRestartIdentity.loaderId)
   throw new Error('Cold-start fixture page identity was not stable before one bounded reload');
  const coldMissingRegistration=await readManagerFixtureRegistration(optionsCdp,fixtureUrl,()=>exited);
   console.log('RG-05 official Chrome registration after missing cold-start GM receipt: '+JSON.stringify(coldMissingRegistration));
   startupWarmup=true;
  console.log('RG-05 cold-start injection was absent; one isolated loopback reload required (not immediate GM injection).');
  await pageCdp.send('Page.reload',{ignoreCache:true});
  try{
   third=await readViolentmonkeyFixtureObservation({
    send:pageCdp.send,frameId:afterRestartIdentity.frameId,
    url:fixtureUrl,previousLoaderId:pinned.loaderId,hasExited:()=>exited,
   });
  }catch(retryError){
   if(!(retryError instanceof Error)||
      retryError.message!=='Pinned Violentmonkey fixture did not publish its bounded GM API result; stage: not-observed'||
      requests.length!==2)throw retryError;
   const reread=await pageCdp.send('Page.getFrameTree');
   const current=reread.frameTree?.frame;
   if(current?.id!==afterRestartIdentity.frameId||
      current?.url!==fixtureUrl||typeof current.loaderId!=='string'||
      !current.loaderId||current.loaderId===pinned.loaderId)
    throw new Error('Cold-start non-injection report lacked a verified fresh fixture document');
   const reloadMissingRegistration=await readManagerFixtureRegistration(optionsCdp,fixtureUrl,()=>exited);
    console.log('RG-05 official Chrome registration after missing reload GM receipt: '+JSON.stringify(reloadMissingRegistration));
    startupInjectionBlocked=true;
  }
 }
 const attestationContext={
  before:{pid:previousChromePid,browserSocket:previousBrowserSocket,
   frameId:beforeRestartIdentity.frameId,loaderId:beforeRestartIdentity.loaderId},
  after:{pid:chrome.pid,browserSocket:status.browserSocket,
   frameId:afterRestartIdentity.frameId,loaderId:afterRestartIdentity.loaderId},
  chromeProduct:status.browser,managerVersion:manifest.version,managerExtensionId:extensionId,
  observedManagers:resumedManagers.observed,appV4:resumedManagers.V4,
  appManagerVerified:resumedManagers.managerVerified,expectedStorageBefore:2,
 };
 if(startupInjectionBlocked){
  // Only AFTER cold restart and one bounded reload both lacked the GM receipt.
  // A bridge response must never count as actual user script GM execution.
  try{
   const bridge=await readOfficialContentBridgeDiagnostic(optionsCdp,fixtureUrl,()=>exited);
   console.log('RG-05 official content bridge after two absent GM receipts: '+JSON.stringify(bridge)+'; no GM or product V4 proof.');
  }catch{
   console.log('RG-05 official content bridge diagnostic unavailable; GM gate still blocked.');
  }
  // Post-failure-only parse probe cannot prewarm official GM on either failed
  // document. These fixed flags only narrow Chrome script-loading hypotheses.
  try{
   const postParsed=await collectOfficialManagerScriptEvidence(pageCdp,afterRestartIdentity.frameId,()=>exited);
   console.log('RG-05 official injector parsed scripts after missing GM receipts: '+JSON.stringify(postParsed)+'; not GM execution proof.');
  }catch{
   console.log('RG-05 official injector parsed scripts after missing GM receipts unavailable; GM gate remains blocked.');
  }
  // Inspect the final already-failed document only. Never invoke GetInjected,
  // navigate again, or turn parsed/bootstrap flags into a fake GM receipt.
  try{
   const postMarker=await restartedMarkerEvidence.read((method,params)=>pageCdp.send(method,params));
   console.log('RG-05 official VM bootstrap marker after missing GM receipts: '+JSON.stringify(postMarker)+'; not GM proof.');
  }catch{
   console.log('RG-05 official VM bootstrap marker after missing GM receipts unavailable; GM gate still blocked.');
  }
  console.log('RG-05 isolated runtime exceptions after missing GM receipts: '+
   JSON.stringify(restartedRuntimeExceptions.snapshot())+'; no private exception data or manager attribution.');
  console.log('RG-05 official injector exception attribution after missing GM receipts: '+
   JSON.stringify(restartedInjectorExceptions.snapshot())+'; fixed bundled assets only, not a GM receipt.');
  console.log('RG-05 official injected.js error class after missing GM receipts: '+
   restartedInjectorExceptions.injectedExceptionClass()+'; allowlisted class only, not GM success.');
  console.log('RG-05 official injected.js failure signature after missing GM receipts: '+
   restartedInjectorExceptions.injectedFailureSignature()+'; fixed upstream signature only, not GM success.');
  // Numeric line/column from the exact official bundled injected.js, not a
  // user script or private stack. Report only AFTER two missing real receipts.
  console.log('RG-05 official injected.js fault site after missing GM receipts: '+
   restartedInjectorExceptions.injectedFailureSite()+'; pinned public asset coordinate, not GM success.');
  // Inspect STATIC syntax in the exact public injected.js of the SHA-256
  // verified official ZIP. This path was constrained to disposable Runner.Temp
  // before Chrome launched. Never request CDP source or inspect a userscript.
  // No original source span, variable, URL, exception or stack is logged.
  try{
   const site=/^L(\d{1,6}):C(\d{1,8})$/.exec(
    restartedInjectorExceptions.injectedFailureSite());
   if(!site)throw new Error('no fixed official exception site');
   const asset=join(absoluteExtensionRoot,'injected.js');
   const expected=await lstat(asset);
   if(!expected.isFile()||expected.isSymbolicLink()||
      expected.nlink!==1||expected.size<1||expected.size>524288)
    throw new Error('official asset not a bounded regular file');
   const bytes=await readPinnedRegularFile(asset,{
    maxBytes:524288,expected,expectedNative:await lstat(asset,{bigint:true}),
   });
   const position=mapPinnedOfficialFaultSite(
    bytes.toString('utf8'),Number(site[1]),Number(site[2]));
   console.log('RG-05 public official injected.js AST site after missing GM receipts: '+
    JSON.stringify(position)+'; static public-bundle fingerprint, not GM success.');
  }catch{
   console.log('RG-05 public official injected.js AST site after missing GM receipts: unavailable; GM gate remains blocked.');
  }
  // A confirmed installed manager that did not inject into TWO fresh process
  // documents is a real RG-05 BLOCKER. Never produce a fixture pass receipt.
  const blocked=classifyOfficialViolentmonkeyRestartBlocker({
   ...attestationContext,fixture:undefined,missedColdStart:true,
   scriptStillInstalled:retainedScript.found===true,
   permissionStillActive:permission.result?.value===JSON.stringify({available:true}),
   loopbackRequestsObserved:requests.length,
  });
  assert.equal(blocked.status,'fixture-restart-blocked');
  assert.equal(blocked.productionEligible,false);
  console.log('BLOCKED RG-05 official VM 2.49.0 Chrome process restart: installed script and permission retained, but GM injection absent after first visit and one isolated reload. Product V4 not-configured.');

  // Real Chrome direct userScripts control on a DIFFERENT disposable page.
  // This only runs after the official GM cold-start blocker is immutable.
  // It can identify a userScripts-runtime limitation vs VM-specific bridge
  // initialization, but must never turn blocked GM into a V4 PASS.
  const directUserScript=await runDirectChromeUserScriptDiagnostic({
   browserCdp,optionsCdp,controlUrl:directControlUrl,hasExited:()=>exited,
  });
  console.log('RG-05 Chrome direct USER_SCRIPT after failed official manager cold start: '+
   JSON.stringify(directUserScript)+'; NOT an official GM receipt or release pass.');
  // Only after official GM is independently blocked: compare the manager-owned
  // default world with the named control. No manager/default world reconfiguration.
  const defaultUserScript=await runDirectChromeUserScriptDiagnostic({
   browserCdp,optionsCdp,controlUrl:directControlUrl,hasExited:()=>exited,
   world:'default',
  });
  console.log('RG-05 Chrome default USER_SCRIPT after failed official manager cold start: '+
   JSON.stringify(defaultUserScript)+'; diagnostic only, GM acceptance remains blocked.');
  // A/B/A order removes a time/order or stale-listener explanation for an
  // apparent default-world failure. Only use a new, disposable synthetic page
  // after the previous registrations/listeners ran their own finally cleanup.
  // The official manager's genuine cold GM verdict is already irrevocable.
  const namedReplayUserScript=await runDirectChromeUserScriptDiagnostic({
   browserCdp,optionsCdp,controlUrl:directControlUrl,hasExited:()=>exited,
  });
  console.log('RG-05 Chrome named replay USER_SCRIPT after failed official manager cold start: '+
   JSON.stringify(namedReplayUserScript)+'; diagnostic only, GM acceptance remains blocked.');

  // Root-cause diagnostic only, after the blocker is already immutable: reload
  // the pinned official extension (not Chrome, not a user profile), then test
  // one NEW loopback document. Recovery would implicate extension lifecycle
  // initialization; failure would keep that hypothesis unproven. Either way
  // the immediate cold-start acceptance gate below remains blocked.
  // Probe only after both real cold-start documents missed GM and the blocker
  // was classified. Passive Chrome WebUI data cannot satisfy the GM gate.
  const preReloadAccess=await collectPreReloadViolentmonkeyAccess({
   browserCdp,hasExited:()=>exited,
  });
  console.log('RG-05 access before extension reload: '+
   JSON.stringify(preReloadAccess)+'; passive post-blocker evidence only, not GM or V4 proof.');
  const reloadDiagnostic=await runPostBlockerExtensionReloadDiagnostic({
   browserCdp,optionsCdp,fixtureUrl,optionsUrl,hasExited:()=>exited,
   allowReload:preReloadAccess.profileDeveloperMode==='enabled',
  });
  let reloadRecovered=false;
  if(reloadDiagnostic.fixture){
   try{
    assertViolentmonkeyV4FixtureObservation({
     chromeProduct:status.browser,managerVersion:manifest.version,
     managerExtensionId:extensionId,observedManagers:resumedManagers.observed,
     appV4:resumedManagers.V4,appManagerVerified:resumedManagers.managerVerified,
     fixture:reloadDiagnostic.fixture,
    },2);
    reloadRecovered=requests.length===3;
   }catch{}
  }
  const reloadStage=reloadRecovered?'recovered':reloadDiagnostic.stage;
  assert.ok(POST_BLOCKER_RELOAD_STAGES.includes(reloadStage));
  console.log('RG-05 post-blocker extension reload diagnostic: checkpoint '+reloadStage+
   ', userScripts access '+JSON.stringify(reloadDiagnostic.accessStatus)+
   ', userScripts access reason '+reloadDiagnostic.accessReason+
   ', userScripts capability '+JSON.stringify(reloadDiagnostic.capabilityStatus)+
   (reloadRecovered?', recovered on one fresh loopback document':', did not recover')+
   '; NOT a release or product V4 pass.');
  assertOfficialViolentmonkeyReleaseGate(blocked.status);
 }else{
  assert.equal(requests.length,3,'cross-process manager test must make exactly one extra GM loopback request');
  assert.ok(requests.every(item=>item.method==='GET'&&item.url==='/gm-request'));
  const restarted=assertOfficialViolentmonkeyProcessRestart({
   ...attestationContext,fixture:third,
   loopbackRequestsObserved:requests.length,startupWarmup,
  });
  assert.equal(restarted.status,startupWarmup?'fixture-restart-warmup-passed':'fixture-restart-passed');
  assertOfficialViolentmonkeyReleaseGate(restarted.status);
  console.log('PASS official VM 2.49.0 isolated Chrome process restart: GM 0->1->2->3; cold-start injection '+restarted.coldStartInjection+'. Product V4 not-configured.');
 }

 // Only the exact immediate post-restart receipt above may report PASS.
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
