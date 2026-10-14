import type {ChromeTarget} from '../../cdp-client/src/index.ts';
import {asCss,type LiteralLocator,type LocatorProbeResult} from '../../cdp-client/src/locator-probe.ts';
import type {ReadOnlyVisibilityEvidence} from '../../cdp-client/src/read-only-visibility.ts';
import type {ReadOnlyEventListenerEvidence} from '../../cdp-client/src/read-only-event-listeners.ts';
import {validateCdpPageSocket} from '../../cdp-client/src/endpoint.ts';
import {assertCredentialFreePageUrl} from '../../cdp-client/src/page-url-safety.ts';
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
 assertCredentialFreePageUrl(target.url);
 validateCdpPageSocket(target);
 if(typeof caseId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(caseId))
  throw new Error('Invalid read-only readiness case ID');
 if(!locator||locator.runtimeRequired||typeof locator.expression!=='string'||
    locator.expression.trim()===''||locator.expression.length>1024||
    !['querySelector','querySelectorAll','getElementById','getElementsByClassName',
      'getElementsByName'].includes(locator.method)||asCss(locator)===null)
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
  {kind:'review';reason:string}> => {
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
     ['disabled-attribute','aria-disabled','readonly-attribute'].includes(v.controlBlocker)){
   // A blocker is meaningful only for the node originally pinned. React
   // rerenders and SPA swaps can replace a selector target during CSS reads
   // without changing the top frame/loader. A changed node is inconclusive,
   // not proof that the original control was disabled or hidden.
   let blockedNode:LocatorProbeResult;
   try{blockedNode=await deps.probe(target,[locator]);}
   catch{await guard();return {kind:'review',reason:'Blocked-control node identity could not be reconfirmed'};}
   await guard();
   if(fingerprint(blockedNode,target,locator)!==key)
    return {kind:'review',reason:'Control node changed before blocker could be confirmed'};
   return {kind:'blocked',reason:'Control has an observed read-only blocker'};
  }
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
  // CSS and listener evidence are collected over separate CDP sockets. A
  // dynamic page can replace the selector's target without changing its URL,
  // frame or loader. Pin the DOM node again before accepting this sample;
  // cross-sample identity alone cannot detect a swap inside one observation.
  let after:LocatorProbeResult;
  try{after=await deps.probe(target,[locator]);}
  catch{await guard();return {kind:'review',reason:'Post-metadata DOM node observation unavailable'};}
  await guard();
  if(fingerprint(after,target,locator)!==key)
   return {kind:'review',reason:'DOM node changed during read-only control observations'};
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

/** FR-025: user-triggered, bounded read-only wait until one pinned top-document
 * node is visible in TWO consecutive observations. No DOM mutation, page JS,
 * input event or userscript execution. A V1 visibility witness cannot prove
 * V2 interactivity, V3 named function or V4 userscript-manager behavior. */
export interface ReadOnlyVisibilityWaitResult {
 readonly caseId:string;
 readonly status:'visible-v1'|'needs-review';
 readonly samples:1|2|3|4;
 readonly reason:string;
 readonly evidenceLevel:'V1-visible-read-only';
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
 readonly interactionVerified:false;
 readonly functionalVerified:false;
 readonly managerVerified:false;
}
export async function runReadOnlyVisibilityWait({
 approved,target,locator,caseId,maxSamples,deps,
}:{
 readonly approved:boolean;readonly target:ChromeTarget;
 readonly locator:LiteralLocator;readonly caseId:string;
 readonly maxSamples:2|3|4;
 readonly deps:Pick<ReadinessDeps,'confirm'|'probe'|'inspectVisibility'|'wait'>;
}):Promise<ReadOnlyVisibilityWaitResult>{
 if(approved!==true)throw new Error('Explicit read-only visibility wait approval required');
 if(!target||target.type!=='page'||typeof target.id!=='string'||!target.id||
    target.id.length>128||typeof target.url!=='string')
  throw new Error('Invalid read-only visibility wait target');
 assertCredentialFreePageUrl(target.url);
 validateCdpPageSocket(target);
 if(typeof caseId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(caseId)||
    ![2,3,4].includes(maxSamples))
  throw new Error('Invalid visibility wait case or samples');
 if(!locator||locator.runtimeRequired||typeof locator.expression!=='string'||
    locator.expression.length>1024||!locator.expression.trim()||
    !['querySelector','querySelectorAll','getElementById','getElementsByClassName',
      'getElementsByName'].includes(locator.method)||asCss(locator)===null)
  throw new Error('Supported static locator required for read-only visibility wait');
 if(!deps||typeof deps.confirm!=='function'||typeof deps.probe!=='function'||
    typeof deps.inspectVisibility!=='function'||typeof deps.wait!=='function')
  throw new Error('Invalid read-only visibility wait dependencies');
 const result=(status:'visible-v1'|'needs-review',samples:1|2|3|4,reason:string):ReadOnlyVisibilityWaitResult=>({
  caseId,status,samples,reason,evidenceLevel:'V1-visible-read-only',
  V2:'blocked',V3:'not-configured',V4:'not-configured',
  interactionVerified:false,functionalVerified:false,managerVerified:false,
 });
 const confirm=async()=>{
  try{return await deps.confirm(target);}
  catch{throw new Error('CDP document confirmation unavailable during visibility wait');}
 };
 const baseline=await confirm();
 if(baseline.targetId!==target.id||baseline.confirmedUrl!==target.url||
    !baseline.frameId||!baseline.loaderId)
  throw new Error('Invalid pinned visibility wait document identity');
 const guard=async()=>assertStablePageDocument(baseline,await confirm());
 let prior:string|null=null,consecutive=0;
 for(let n=1;n<=maxSamples;n++){
  const samples=n as 1|2|3|4;
  await guard();
  let pre:LocatorProbeResult;
  try{pre=await deps.probe(target,[locator]);}
  catch{await guard();return result('needs-review',samples,'DOM observation unavailable');}
  await guard();
  if(!pre||pre.validationLevel!=='dom-only'||pre.targetId!==target.id||
     pre.url!==target.url||!Array.isArray(pre.checks)||pre.checks.length!==1||
     pre.checks[0]?.method!==locator.method||pre.checks[0]?.expression!==locator.expression)
   return result('needs-review',samples,'Inconsistent DOM visibility wait evidence');
  const observed=pre.checks[0]!;
  if(observed.status==='missing'&&observed.matchCount===0){
   prior=null;consecutive=0;
  }else{
   const key=fingerprint(pre,target,locator);
   if(!key)return result('needs-review',samples,'Target not uniquely pinned for visibility wait');
   let visible:ReadOnlyVisibilityEvidence;
   try{visible=await deps.inspectVisibility(target,locator);}
   catch{await guard();return result('needs-review',samples,'CSS visibility observation unavailable');}
   await guard();
   if(!validateVisibility(visible,target)||visible.matchCount!==1||
      (visible.status!=='potentially-visible'&&visible.status!=='hidden'))
    return result('needs-review',samples,'Invalid or inconclusive CSS visibility metadata');
   let post:LocatorProbeResult;
   try{post=await deps.probe(target,[locator]);}
   catch{await guard();return result('needs-review',samples,'DOM identity reconfirmation unavailable');}
   await guard();
   if(fingerprint(post,target,locator)!==key)
    return result('needs-review',samples,'DOM node changed during visibility observation');
   if(visible.status==='potentially-visible'){
    consecutive=prior===key?consecutive+1:1;
    prior=key;
    if(consecutive>=2)return result('visible-v1',samples,
     'Same pinned top-document node was visible in two successive read-only observations; user script and interaction not verified');
   }else{prior=null;consecutive=0;}
  }
  if(n<maxSamples){
   try{await deps.wait();}
   catch{await guard();return result('needs-review',samples,'Bounded visibility wait interrupted');}
  }
 }
 return result('needs-review',maxSamples,'No two consecutive stable visible samples within approved read-only observation budget');
}
