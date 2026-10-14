import {validateCdpBrowserSocket} from '../packages/cdp-client/src/endpoint.ts';
import {
 assertViolentmonkeyV4FixtureObservation,
 type ViolentmonkeyFixtureObservation,
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
 status:'fixture-restart-passed';
 validationLevel:'isolated-manager-process-restart';
 storageBefore:2;storageAfter:3;
 requestsObserved:3;
 productionEligible:false;
 V4:'not-configured';managerVerified:false;functionalVerified:false;
}>{
 const fail=():never=>{throw new Error('Pinned manager restart identity or fixture evidence incomplete');};
 if(!input||typeof input!=='object'||Array.isArray(input)||
    !input.before||!input.after||input.expectedStorageBefore!==2||
    input.loopbackRequestsObserved!==3)fail();
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
  status:'fixture-restart-passed',
  validationLevel:'isolated-manager-process-restart',
  storageBefore:2,storageAfter:3,requestsObserved:3,
  productionEligible:false,V4:'not-configured',
  managerVerified:false,functionalVerified:false,
 });
}
