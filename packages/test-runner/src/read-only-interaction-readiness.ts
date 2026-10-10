import type {ChromeTarget} from '../../cdp-client/src/index.ts';
import type {LiteralLocator,LocatorProbeResult} from '../../cdp-client/src/locator-probe.ts';
import type {ReadOnlyVisibilityEvidence} from '../../cdp-client/src/read-only-visibility.ts';
import type {ReadOnlyEventListenerEvidence} from '../../cdp-client/src/read-only-event-listeners.ts';
import {validateCdpPageSocket} from '../../cdp-client/src/endpoint.ts';
import {assertStablePageDocument,type ConfirmedPageIdentity} from '../../cdp-client/src/page-identity.ts';

export type ReadinessStatus='potentially-ready'|'blocked'|'needs-review';
export interface ReadOnlyInteractionReadinessResult{
 readonly caseId:string;
 readonly status:ReadinessStatus;
 readonly reason:string;
 readonly evidenceLevel:'V1+read-only-control-metadata';
 readonly samples:1|2;
 readonly directClickListeners:number|null;
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
 readonly interactionVerified:false;
 readonly functionalVerified:false;
 readonly managerVerified:false;
}
export interface ReadinessDeps{
 confirm:(target:ChromeTarget)=>Promise<ConfirmedPageIdentity>;
 probe:(target:ChromeTarget,locators:readonly LiteralLocator[])=>Promise<LocatorProbeResult>;
 inspectVisibility:(target:ChromeTarget,locator:LiteralLocator)=>Promise<ReadOnlyVisibilityEvidence>;
 inspectListeners:(target:ChromeTarget,locator:LiteralLocator)=>Promise<ReadOnlyEventListenerEvidence>;
 wait:()=>Promise<void>;
}
type Sample={fingerprint:string;listenerCount:number};
const safeId=/^[0-9a-f]{64}$/;
function fingerprint(probe:LocatorProbeResult,target:ChromeTarget,locator:LiteralLocator):string|null{
 if(!probe||probe.validationLevel!=='dom-only'||probe.targetId!==target.id||
   probe.url!==target.url||!Array.isArray(probe.checks)||probe.checks.length!==1)return null;
 const check=probe.checks[0];
 return check&&check.method===locator.method&&check.expression===locator.expression&&
  check.status==='found'&&check.matchCount===1&&
  typeof check.nodeFingerprint==='string'&&safeId.test(check.nodeFingerprint)?
   check.nodeFingerprint:null;
}
function validateVisibility(e:ReadOnlyVisibilityEvidence,target:ChromeTarget):boolean{
 return !!e&&e.targetId===target.id&&e.url===target.url&&
  e.validationLevel==='css-box-read-only'&&e.V2==='blocked'&&
  e.V3==='not-configured'&&e.V4==='not-configured'&&
  e.interactionVerified===false;
}
function validateListeners(e:ReadOnlyEventListenerEvidence,target:ChromeTarget):boolean{
 return !!e&&e.targetId===target.id&&e.url===target.url&&
  e.validationLevel==='direct-event-listener-read-only'&&
  e.eventType==='click'&&e.V2==='blocked'&&
  e.V3==='not-configured'&&e.V4==='not-configured'&&
  e.interactionVerified===false;
}
/**
 * Bounded, two-sample correlation of live DOM node identity, basic CSS control
 * metadata and direct click listener registration. It is explicitly NOT a
 * clickability test or proof that a userscript/GM API executed successfully.
 * CSS inherited blockers, overlays, delegated handlers and frame/shadow nodes
 * can remain unseen, so even positive evidence always leaves V2 blocked.
 */
export async function runReadOnlyInteractionReadiness({
 approved,target,locator,caseId,deps,
}:{
 readonly approved:boolean;readonly target:ChromeTarget;readonly locator:LiteralLocator;
 readonly caseId:string;readonly deps:ReadinessDeps;
}):Promise<ReadOnlyInteractionReadinessResult>{
 if(approved!==true)throw new Error('Explicit read-only readiness approval required');
 if(!target||target.type!=='page'||typeof target.id!=='string'||!target.id||
    target.id.length>128||typeof target.url!=='string'||!/^https?:\/\//.test(target.url))
  throw new Error('Invalid readiness CDP target');
 validateCdpPageSocket(target);
 if(typeof caseId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(caseId))
  throw new Error('Invalid read-only readiness case ID');
 if(!locator||locator.runtimeRequired||typeof locator.expression!=='string'||
    locator.expression.trim()===''||locator.expression.length>1024||
    !['querySelector','querySelectorAll','getElementById','getElementsByClassName',
      'getElementsByName'].includes(locator.method))
  throw new Error('A static supported selector is required for read-only readiness');
 if(!deps||typeof deps.confirm!=='function'||typeof deps.probe!=='function'||
    typeof deps.inspectVisibility!=='function'||typeof deps.inspectListeners!=='function'||
    typeof deps.wait!=='function')
  throw new Error('Invalid read-only readiness dependencies');
 const make=(status:ReadinessStatus,reason:string,samples:1|2,listeners:number|null=null):ReadOnlyInteractionReadinessResult=>({
  caseId,status,reason,samples,directClickListeners:listeners,
  evidenceLevel:'V1+read-only-control-metadata',
  V2:'blocked',V3:'not-configured',V4:'not-configured',
  interactionVerified:false,functionalVerified:false,managerVerified:false,
 });
 const baseline=await deps.confirm(target);
 if(baseline.targetId!==target.id||baseline.confirmedUrl!==target.url||
    !baseline.frameId||!baseline.loaderId)
  throw new Error('Unverified CDP document identity for readiness');
 const guard=async()=>{
  const identity=await deps.confirm(target);
  assertStablePageDocument(baseline,identity);
 };
 const sample=async():Promise<
  {kind:'ready';value:Sample}|
  {kind:'blocked';reason:string}|
  {kind:'review';reason:string}
 >=>{
  await guard();
  let p:LocatorProbeResult;
  try{p=await deps.probe(target,[locator]);}
  catch{await guard();return {kind:'review',reason:'DOM node identity observation unavailable'};}
  await guard();
  const key=fingerprint(p,target,locator);
  if(!key)return {kind:'review',reason:'No unique pinned top-document node was proven'};
  let v:ReadOnlyVisibilityEvidence;
  try{v=await deps.inspectVisibility(target,locator);}
  catch{await guard();return {kind:'review',reason:'CSS control observation unavailable'};}
  await guard();
  if(!validateVisibility(v,target))
   return {kind:'review',reason:'CSS control evidence invalid or inconsistent'};
  if(v.status==='hidden'||v.pointerBlocked===true||
     ['disabled-attribute','aria-disabled','readonly-attribute'].includes(v.controlBlocker))
   return {kind:'blocked',reason:'Control has an observed read-only blocker'};
  if(v.status!=='potentially-visible'||v.matchCount!==1||
     v.pointerBlocked!==false||v.controlBlocker!=='none-detected')
   return {kind:'review',reason:'Control visibility or blocker metadata incomplete'};
  let e:ReadOnlyEventListenerEvidence;
  try{e=await deps.inspectListeners(target,locator);}
  catch{await guard();return {kind:'review',reason:'Direct listener observation unavailable'};}
  await guard();
  if(!validateListeners(e,target)||e.status!=='registered'||
     !Number.isSafeInteger(e.listenerCount)||e.listenerCount===null||
     e.listenerCount<1||e.listenerCount>512)
   return {kind:'review',reason:'No consistent direct click listener was confirmed'};
  return {kind:'ready',value:{fingerprint:key,listenerCount:e.listenerCount}};
 };
 const first=await sample();
 if(first.kind==='blocked')return make('blocked',first.reason,1);
 if(first.kind==='review')return make('needs-review',first.reason,1);
 try{await deps.wait();}catch{await guard();return make('needs-review','Read-only resampling was interrupted',1);}
 await guard();
 const second=await sample();
 if(second.kind==='blocked')return make('blocked',second.reason,2);
 if(second.kind==='review')return make('needs-review',second.reason,2);
 if(first.value.fingerprint!==second.value.fingerprint||
    first.value.listenerCount!==second.value.listenerCount)
  return make('needs-review','Node identity or listener count changed between samples',2);
 return make('potentially-ready',
  'Stable top-document node and direct control metadata observed twice; no click or userscript functionality verified',
  2,second.value.listenerCount);
}
