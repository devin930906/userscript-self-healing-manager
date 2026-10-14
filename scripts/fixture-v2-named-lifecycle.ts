import type {ChromeTarget} from '../packages/cdp-client/src/index.ts';
import type {ConfirmedPageIdentity} from '../packages/cdp-client/src/page-identity.ts';
import {assertStablePageDocument} from '../packages/cdp-client/src/page-identity.ts';
import {assessSyntheticActionBoundary} from '../packages/test-runner/src/synthetic-action-boundary.ts';
import type {ReadOnlyDomContractResult} from '../packages/test-runner/src/index.ts';
import type {SyntheticFixtureInteractionResult} from './local-fixture-interaction.ts';

export interface FixtureV2LifecycleReceipt {
 readonly status:'fixture-passed';
 readonly validationLevel:'synthetic-v2-lifecycle';
 readonly namedCase:'fixed-synthetic-click-count-transition';
 readonly beforeCount:1;
 readonly afterCount:2;
 readonly cleanedCount:1;
 readonly cleanupVerified:true;
 readonly productionEligible:false;
 readonly V2:'blocked';readonly V3:'not-configured';readonly V4:'not-configured';
 readonly functionalVerified:false;readonly managerVerified:false;
}
export interface FixtureV2LifecycleDependencies {
 readonly confirm:(target:ChromeTarget)=>Promise<ConfirmedPageIdentity>;
 readonly observe:(target:ChromeTarget)=>Promise<ReadOnlyDomContractResult>;
 readonly interact:(target:ChromeTarget)=>Promise<SyntheticFixtureInteractionResult>;
 /** Tests ONLY: reload the app-owned ephemeral fixture, never a user browser. */
 readonly reset:(target:ChromeTarget)=>Promise<void>;
 readonly wait?:()=>Promise<void>;
}
function expectedObservation(e:ReadOnlyDomContractResult,count:number):void{
 if(!e||e.expectation!=='exists'||e.status!=='passed'||e.evidenceLevel!=='V1'||
    e.attempts!==2||e.matchCount!==count||
    e.V2!=='blocked'||e.V3!=='not-configured'||e.V4!=='not-configured'||
    e.functionalVerified!==false||e.managerVerified!==false)
  throw new Error('Synthetic fixture named effect count or read-only evidence invalid');
}
function validateIdentity(identity:ConfirmedPageIdentity,target:ChromeTarget):void{
 if(!identity||identity.targetId!==target.id||identity.confirmedUrl!==target.url||
    !identity.frameId||!identity.loaderId)
  throw new Error('Invalid synthetic fixture document identity');
}
/**
 * TEST-ONLY named V2 lifecycle. This is not a production interaction executor.
 * It deliberately cannot return product V2=passed: one actual isolated click
 * and restored synthetic fixture state do not certify a user website/userscript.
 */
export async function runNamedFixtureV2Lifecycle({
 approved,target,fixtureUrl,deps,
}:{
 readonly approved:boolean;readonly target:ChromeTarget;readonly fixtureUrl:string;
 readonly deps:FixtureV2LifecycleDependencies;
}):Promise<FixtureV2LifecycleReceipt>{
 assessSyntheticActionBoundary({approved,action:'fixture-test-click',
  elementId:'fixture-safe-click',target,fixtureUrl});
 if(!deps||typeof deps.confirm!=='function'||typeof deps.observe!=='function'||
    typeof deps.interact!=='function'||typeof deps.reset!=='function'||
    (deps.wait!==undefined&&typeof deps.wait!=='function'))
  throw new Error('Invalid synthetic fixture lifecycle dependencies');
 // Retain an exact document identity before any action, including prestate read.
 const before=await deps.confirm(target);
 validateIdentity(before,target);
 let failure:Error|null=null;
 let cleanupFailure:Error|null=null;
 let cleanupPhase:'reset'|'fresh-loader'|'restore-observation'|'restore-identity'='reset';
 try{
  const start=await deps.observe(target);
  expectedObservation(start,1);
  assertStablePageDocument(before,await deps.confirm(target));
  const click=await deps.interact(target);
  if(!click||click.validationLevel!=='synthetic-fixture-interaction'||
     click.observed!==true||click.productionEligible!==false)
   throw new Error('Synthetic fixture action was not observed');
  assertStablePageDocument(before,await deps.confirm(target));
  const after=await deps.observe(target);
  expectedObservation(after,2);
  assertStablePageDocument(before,await deps.confirm(target));
 }catch{failure=new Error('Synthetic fixture named action or effect could not be verified');}
 // Cleanup is mandatory after this test-only lifecycle has begun, including
 // when the click or the poststate verification failed. Never issue a PASS
 // receipt for a failed reset, silent navigation, or leftover marker.
 try{
  await deps.reset(target);
  cleanupPhase='fresh-loader';
  let fresh:ConfirmedPageIdentity|null=null;
  for(let i=0;i<16;i++){
   try{
    const seen=await deps.confirm(target);
    validateIdentity(seen,target);
    if(seen.frameId===before.frameId&&seen.loaderId!==before.loaderId){
     fresh=seen;break;
    }
   }catch{/* Reload may briefly leave the document unavailable. */}
   if(i<15)await (deps.wait?.()??new Promise<void>(resolve=>setTimeout(resolve,125)));
  }
  if(!fresh)throw new Error('Synthetic fixture cleanup did not create a fresh document');
  // A new top-level loader can precede child-frame settlement. Each
  // bounded retry must pin the SAME complete document identity before
  // and after a fresh two-sample DOM proof. Never waive the iframe guard.
  let verified=false;
  for(let attempt=0;attempt<8;attempt++){
   try{
    cleanupPhase='restore-identity';
    const pinned=await deps.confirm(target);
    validateIdentity(pinned,target);
    if(pinned.frameId!==fresh.frameId||pinned.loaderId!==fresh.loaderId)
     throw new Error('Synthetic fixture cleanup document changed again');
    cleanupPhase='restore-observation';
    const clean=await deps.observe(target);
    expectedObservation(clean,1);
    cleanupPhase='restore-identity';
    assertStablePageDocument(pinned,await deps.confirm(target));
    verified=true;break;
   }catch{
    if(attempt<7)await (deps.wait?.()??new Promise<void>(resolve=>setTimeout(resolve,125)));
   }
  }
  if(!verified)throw new Error('Synthetic fixture cleanup did not prove a stable restored baseline');
 }catch{cleanupFailure=new Error('Synthetic fixture cleanup could not be verified ('+cleanupPhase+')');}
 if(cleanupFailure)throw cleanupFailure;
 if(failure)throw failure;
 return Object.freeze({
  status:'fixture-passed',validationLevel:'synthetic-v2-lifecycle',
  namedCase:'fixed-synthetic-click-count-transition',
  beforeCount:1,afterCount:2,cleanedCount:1,cleanupVerified:true,
  productionEligible:false,V2:'blocked',V3:'not-configured',V4:'not-configured',
  functionalVerified:false,managerVerified:false,
 });
}
