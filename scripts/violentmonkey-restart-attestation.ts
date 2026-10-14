import {validateCdpBrowserSocket} from '../packages/cdp-client/src/endpoint.ts';
import {
 assertViolentmonkeyV4FixtureObservation,
 type ViolentmonkeyFixtureObservation,
 VIOLENTMONKEY_CFT_RELEASE,
} from './violentmonkey-v4-contract.ts';

type RestartEndpoint=Readonly<{
 pid:number;
 browserSocket:string;
 frameId:string;
 loaderId:string;
}>;

export type OfficialViolentmonkeyRestartObservation=ViolentmonkeyFixtureObservation&Readonly<{
 before:RestartEndpoint;
 after:RestartEndpoint;
 loopbackRequestsObserved:number;
 expectedStorageBefore:2;
 /** True only if exactly one isolated fixture Page.reload was required after Chrome cold-start. */
 startupWarmup?:boolean;
}>;

/**
 * Test-only, official-manager process restart attestation. Reopening a tab or
 * Page.reload is insufficient. Different OS PID, browser WebSocket session,
 * main frame and document loader MUST all be observed, with the same isolated
 * profile enforced by the CFT harness and the real manager GM receipt.
 * This is NEVER evidence that arbitrary user scripts or app V4 passed.
 */
export function assertOfficialViolentmonkeyProcessRestart(
 input:OfficialViolentmonkeyRestartObservation,
):Readonly<{
 status:'fixture-restart-passed'|'fixture-restart-warmup-passed';
 coldStartInjection:'immediate'|'reload-required';
 validationLevel:'isolated-manager-process-restart';
 storageBefore:2;storageAfter:3;
 requestsObserved:3;
 productionEligible:false;
 V4:'not-configured';managerVerified:false;functionalVerified:false;
}>{
 const fail=():never=>{throw new Error('Pinned manager restart identity or fixture evidence incomplete');};
 if(!input||typeof input!=='object'||Array.isArray(input)||
    !input.before||!input.after||input.expectedStorageBefore!==2||
    input.loopbackRequestsObserved!==3||
    (input.startupWarmup!==undefined&&typeof input.startupWarmup!=='boolean'))fail();
 const valid=(part:RestartEndpoint)=>{
  if(!part||!Number.isSafeInteger(part.pid)||part.pid<2||part.pid>0x7fffffff||
     typeof part.frameId!=='string'||!part.frameId||part.frameId.length>256||
     typeof part.loaderId!=='string'||!part.loaderId||part.loaderId.length>256)
   fail();
  try{validateCdpBrowserSocket(part.browserSocket,9223);}
  catch{fail();}
 };
 valid(input.before);valid(input.after);
 if(input.before.pid===input.after.pid||
    input.before.browserSocket===input.after.browserSocket||
    input.before.frameId===input.after.frameId||
    input.before.loaderId===input.after.loaderId)fail();
 try{
  assertViolentmonkeyV4FixtureObservation({
   chromeProduct:input.chromeProduct,
   managerVersion:input.managerVersion,
   managerExtensionId:input.managerExtensionId,
   observedManagers:input.observedManagers,
   appV4:input.appV4,
   appManagerVerified:input.appManagerVerified,
   fixture:input.fixture,
  },2);
 }catch{fail();}
 return Object.freeze({
  status:input.startupWarmup===true?'fixture-restart-warmup-passed':'fixture-restart-passed',
  coldStartInjection:input.startupWarmup===true?'reload-required':'immediate',
  validationLevel:'isolated-manager-process-restart',
  storageBefore:2,storageAfter:3,requestsObserved:3,
  productionEligible:false,V4:'not-configured',
  managerVerified:false,functionalVerified:false,
 });
}

/**
 * A separately reportable real Chrome/official manager regression.
 * It is NOT a fixture pass, V4 pass, or proof that a saved script executed.
 * The integration harness must establish all boolean assertions from its
 * own pinned/approved, synthetic disposable Chrome profile.
 */
export function classifyOfficialViolentmonkeyRestartBlocker(input:
 Omit<OfficialViolentmonkeyRestartObservation,'fixture'|'loopbackRequestsObserved'> & Readonly<{
  fixture?:undefined;
  missedColdStart:true;
  scriptStillInstalled:true;
  permissionStillActive:true;
  loopbackRequestsObserved:2;
 }>,
):Readonly<{
 status:'fixture-restart-blocked';reason:'cold-start-injection-not-observed';
 validationLevel:'isolated-manager-process-restart';
 productionEligible:false;V4:'not-configured';
 managerVerified:false;functionalVerified:false;
}>{
 const fail=():never=>{throw new Error('Pinned manager restart blocker evidence incomplete');};
 if(!input||typeof input!=='object'||Array.isArray(input)||
    !input.before||!input.after||
    input.missedColdStart!==true||input.scriptStillInstalled!==true||
    input.permissionStillActive!==true||input.loopbackRequestsObserved!==2||
    input.expectedStorageBefore!==2||input.fixture!==undefined||
    input.appV4!=='not-configured'||input.appManagerVerified!==false||
    input.managerVersion!==VIOLENTMONKEY_CFT_RELEASE.version||
    input.managerExtensionId!==VIOLENTMONKEY_CFT_RELEASE.extensionId||
    !Array.isArray(input.observedManagers)||!input.observedManagers.includes('violentmonkey')||
    typeof input.chromeProduct!=='string'||
    !/^(?:Chrome|HeadlessChrome)\/155\./.test(input.chromeProduct))
  fail();
 for(const part of [input.before,input.after]){
  if(!Number.isSafeInteger(part.pid)||part.pid<2||part.pid>0x7fffffff||
     typeof part.frameId!=='string'||!part.frameId||part.frameId.length>256||
     typeof part.loaderId!=='string'||!part.loaderId||part.loaderId.length>256)
   fail();
  try{validateCdpBrowserSocket(part.browserSocket,9223);}catch{fail();}
 }
 if(input.before.pid===input.after.pid||
    input.before.browserSocket===input.after.browserSocket||
    input.before.frameId===input.after.frameId||
    input.before.loaderId===input.after.loaderId)fail();
 return Object.freeze({
  status:'fixture-restart-blocked',
  reason:'cold-start-injection-not-observed',
  validationLevel:'isolated-manager-process-restart',
  productionEligible:false,V4:'not-configured',
  managerVerified:false,functionalVerified:false,
 });
}
