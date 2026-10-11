import {createHash} from 'node:crypto';
import type {ScanItemResult} from './index.ts';
import type {ChromeTarget} from '../../cdp-client/src/index.ts';
import type {LiteralLocator,LocatorProbeResult} from '../../cdp-client/src/locator-probe.ts';
import {assertStablePageDocument,type ConfirmedPageIdentity} from '../../cdp-client/src/page-identity.ts';
import {validateCdpPageSocket} from '../../cdp-client/src/endpoint.ts';
import {checkUserscriptPageScope} from '../../candidate-engine/src/page-scope.ts';
import {summarizeLiveLocatorCheck} from './health.ts';
import {projectVerificationLevels,type VerificationProjection} from './verification-levels.ts';

export type BatchDomStatus='locator-missing'|'dom-present'|'needs-review'|'no-evidence'|'out-of-scope'|'skipped'|'error';
export interface BatchDomItem {
 readonly index:number;
 readonly scriptId:string|null;
 readonly path:string;
 readonly status:BatchDomStatus;
 readonly checked:number;
 readonly found:number;
 readonly missing:number;
 readonly needsReview:number;
 readonly reason?:string;
 readonly verification?:VerificationProjection;
}
export interface BatchDomResult {
 readonly validationLevel:'dom-only';
 readonly pageTargetId:string;
 readonly pageUrl:string;
 readonly pageDocumentToken?:string;
 readonly totalItems:number;
 readonly items:readonly BatchDomItem[];
}
export interface BatchDomDependencies {
 confirm:(target:ChromeTarget)=>Promise<ConfirmedPageIdentity>;
 probe:(target:ChromeTarget,locators:readonly LiteralLocator[])=>Promise<LocatorProbeResult>;
 /** Optional, trusted bounded delay before re-reading initial misses; does not run page JavaScript. */
 waitBeforeMissingRecheck?:()=>Promise<void>;
 /** Optional until all adapters implement bounded, read-only DOMSnapshot context checks. */
 summarize?:(target:ChromeTarget)=>Promise<{targetId:string;url:string;authorShadowTreeNodes:number}>;
}
/** Require live frame/loader tokens even when every script is out of scope.
 * A matching URL alone cannot authenticate a reload or iframe context. */
function assertVerifiedFrameIdentity(identity:ConfirmedPageIdentity):void {
 if(!identity||typeof identity.frameId!=='string'||!identity.frameId||
    identity.frameId.length>256||typeof identity.loaderId!=='string'||
    !identity.loaderId||identity.loaderId.length>256)
  throw new Error('Unverified CDP main-frame document identity: frame or loader token missing');
 const count=identity.subframeCount;
 if(count!==undefined&&(!Number.isSafeInteger(count)||count<0||count>64))
  throw new Error('Unverified CDP frame count in document identity');
 const child=identity.soleSameOriginSubframe;
 if(child!==undefined&&
    (count!==1||!child||typeof child.frameId!=='string'||!child.frameId||
     child.frameId.length>256||child.frameId===identity.frameId||
     typeof child.loaderId!=='string'||!child.loaderId||child.loaderId.length>256))
  throw new Error('Unverified CDP child frame identity');
}
function assertPageIdentity(target:ChromeTarget,evidence:{targetId:string;confirmedUrl?:string;url?:string}):void {
 if(evidence.targetId!==target.id||(evidence.confirmedUrl??evidence.url)!==target.url)
  throw new Error('CDP page identity or live frame URL changed during batch diagnosis');
}
/** Protect the batch boundary even if an adapter returns an invalid object
 * instead of throwing. One script's corrupt CDP payload cannot abort others. */
function matchesProbeShape(value:unknown,target:ChromeTarget,locators:readonly LiteralLocator[]):value is LocatorProbeResult{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const evidence=value as Partial<LocatorProbeResult>;
 return evidence.targetId===target.id&&evidence.url===target.url&&
  evidence.validationLevel==='dom-only'&&Array.isArray(evidence.checks)&&
  evidence.checks.length===locators.length&&
  evidence.checks.every((check:unknown,i)=>{
   if(!check||typeof check!=='object'||Array.isArray(check))return false;
   const row=check as {method?:unknown;expression?:unknown};
   return row.method===locators[i]!.method&&row.expression===locators[i]!.expression;
  });
}
/**
 * No scripts run and no files are modified. All CDP calls are read-only, bounded,
 * scoped to explicit @match/@include rules and fenced by live top-frame checks.
 */
export async function diagnoseScriptsOnPage({items,target,consent,deps}:{
 items:readonly ScanItemResult[];target:ChromeTarget;consent:boolean;deps:BatchDomDependencies;
}):Promise<BatchDomResult> {
 if(consent!==true)throw new Error('Explicit user consent required for batch page inspection');
 if(items.length>25)throw new Error('Batch safety limit exceeded: maximum 25 scripts per operation');
 if(!target||target.type!=='page'||typeof target.id!=='string'||!target.id||target.id.length>128||
    typeof target.url!=='string'||!/^https?:\/\//i.test(target.url))throw new Error('Invalid CDP page target');
 // Authentication must precede even the first page-identity callback: a
 // future scan adapter must never receive a remote or mismatched debugger.
 validateCdpPageSocket(target);
 // Page identity must be authenticated even if all scripts are out of scope
 // or have only dynamic locators. Observe nested frames without storing URLs.
 let nestedFramesSeen=false;
 let baselineDocument:ConfirmedPageIdentity|undefined;
 const checkIdentity=async()=>{
  const identity=await deps.confirm(target);
  assertVerifiedFrameIdentity(identity);
  assertPageIdentity(target,identity);
  if(baselineDocument)assertStablePageDocument(baselineDocument,identity);
  else baselineDocument=identity;
  if((identity.subframeCount??0)>0)nestedFramesSeen=true;
 };
 await checkIdentity();
 const results:BatchDomItem[]=[];
 for(let index=0;index<items.length;index++){
  const script=items[index]!;
  const common={index,scriptId:script.scriptId??null,path:script.path};
  const analysis=script.analysis;
  if(!analysis||script.status==='parse-error'||script.status==='unreadable'){
   results.push({...common,status:'skipped',checked:0,found:0,missing:0,needsReview:0,reason:'No valid static analysis'});
   continue;
  }
  const scope=checkUserscriptPageScope(analysis.metadata,target.url);
  if(scope.status!=='allowed'){
   const indeterminate=scope.status==='unknown';
   results.push({...common,status:indeterminate?'needs-review':'out-of-scope',
    checked:0,found:0,missing:0,
    needsReview:indeterminate?Math.max(1,analysis.selectorRecords.length):0,
    reason:scope.reason});
   continue;
  }
  const records=analysis.selectorRecords;
  if(records.length>50){
   results.push({...common,status:'error',checked:0,found:0,missing:0,needsReview:0,reason:'Selector count exceeds batch safety limit'});
   continue;
  }
  if(!records.length){
   results.push({...common,status:'no-evidence',checked:0,found:0,missing:0,needsReview:0,reason:'No selectors identified'});
   continue;
  }
  const locators:LiteralLocator[]=records.map(r=>({
   method:r.method,expression:r.expression,runtimeRequired:r.runtimeRequired||r.receiver!=='document',
  }));
  const staticCount=locators.filter(x=>!x.runtimeRequired).length;
  if(staticCount===0){
   results.push({...common,status:'needs-review',checked:0,found:0,missing:0,needsReview:locators.length,reason:'Only dynamic or non-document locators'});
   continue;
  }
  // Live identity check failures are global: never classify the navigated page as another script's error.
  await checkIdentity();
  let evidence:LocatorProbeResult;
  try{evidence=await deps.probe(target,locators);}
  catch{
   // Even a failed request may have raced with a navigation; do not accept stale batch context.
   await checkIdentity();
   // CDP exceptions may contain selector expressions, URLs, local paths,
   // credentials or site-owned private data. Never return raw text over IPC.
   results.push({...common,status:'error',checked:0,found:0,missing:0,needsReview:0,
    reason:'CDP locator probe failed'});
   continue;
  }
  await checkIdentity();
  if(!matchesProbeShape(evidence,target,locators)){
   results.push({...common,status:'error',checked:0,found:0,missing:0,needsReview:0,reason:'CDP evidence identity or shape mismatch'});
   continue;
  }
  // Modern SPAs may render asynchronously. A single missing sample is not
  // enough to distinguish deferred rendering from a missing selector. Allow
  // one bounded, read-only recheck under the *same* Frame/Loader identity.
  if(deps.waitBeforeMissingRecheck&&evidence.checks.some(check=>check.status==='missing')){
   let retry:LocatorProbeResult|undefined;
   let failure:unknown;
   try{
    await deps.waitBeforeMissingRecheck();
    await checkIdentity();
    retry=await deps.probe(target,locators);
   }catch(error){failure=error;}
   // Never conceal navigation, including when the delay or socket failed.
   await checkIdentity();
   if(failure||!matchesProbeShape(retry,target,locators)){
    results.push({...common,status:'needs-review',checked:locators.length,
     found:0,missing:0,needsReview:locators.length,
     reason:'DOM recheck unverified; cannot certify a locator failure'});
    continue;
   }
   evidence={...retry,checks:retry.checks.map((check,i)=>{
    const first=evidence.checks[i]!;
    // A locator which was present but vanished is unstable, not "broken".
    if(first.status==='found'&&check.status==='missing')
     return {...check,status:'unverified' as const,matchCount:null,
      reason:'Locator changed during bounded DOM recheck'};
    return check;
   })};
  }
  const summary=summarizeLiveLocatorCheck(evidence.checks);
  results.push({...common,status:summary.status,checked:summary.total,found:summary.found,missing:summary.missing,needsReview:summary.needsReview});
 }
 // An all-skipped batch is still evidence about the selected page; reject navigations.
 await checkIdentity();
 // A missing top-document locator is inconclusive if an author-created
 // Shadow Tree exists. A failed/invalid context snapshot is also unknown,
 // never proof of a missing locator. User-agent-only roots are ignored.
 let shadowContext:'absent'|'present'|'unknown'='unknown';
 if(deps.summarize){
  try{
   const context=await deps.summarize(target);
   await checkIdentity();
   if(context.targetId!==target.id||context.url!==target.url||
      !Number.isSafeInteger(context.authorShadowTreeNodes)||context.authorShadowTreeNodes<0||
      context.authorShadowTreeNodes>200_000)
    throw new Error('Invalid Shadow DOM context evidence');
   shadowContext=context.authorShadowTreeNodes>0?'present':'absent';
  }catch{
   // Even an unsuccessful snapshot must not disguise a page navigation.
   await checkIdentity();
   shadowContext='unknown';
  }
 }
 // Unverified iframe and Shadow DOM contexts cannot prove a locator is
 // broken. @noframes excludes iframe execution but does not exclude a
 // ShadowRoot within the top-level document.
 const finalItems=results.map((item,index)=>{
  const metadata=items[index]?.analysis?.metadata;
  const frameUnverified=nestedFramesSeen&&!metadata?.raw.noframes?.length;
  // No context provider is also unknown: absence of evidence is not evidence of no Shadow DOM.
  const shadowUnverified=shadowContext!=='absent';
  if(item.status==='out-of-scope'&&frameUnverified)
   return {...item,status:'needs-review' as const,missing:0,
    needsReview:item.needsReview+Math.max(1,item.missing),
    reason:'iframe browsing context detected; top-document evidence cannot verify nested frames'};
  if(item.status!=='locator-missing')return item;
  if(!frameUnverified&&!shadowUnverified)return item;
  const reasons=[
   frameUnverified?'iframe browsing context detected; top-document evidence cannot verify nested frames':null,
   shadowUnverified?(shadowContext==='present'?
     'Author Shadow DOM detected; top-document selector miss cannot inspect nested ShadowRoot':
     'Shadow DOM context evidence unavailable; top-document selector miss is not conclusive'):null,
  ];
  return {...item,status:'needs-review' as const,missing:0,
   needsReview:item.needsReview+Math.max(1,item.missing),
   reason:reasons.filter(Boolean).join('; ')};
 });
 // The top frame loader changes on same-URL reload. A bounded SHA-256 token
 // lets the page collector compare batches without exposing raw CDP identities.
 const pageDocumentToken=baselineDocument?.frameId&&baselineDocument.loaderId?
  createHash('sha256').update(baselineDocument.frameId+'\0'+baselineDocument.loaderId).digest('hex'):undefined;
 const validatedItems=finalItems.map((entry,index)=>({
  ...entry,verification:projectVerificationLevels({
   staticStatus:items[index]?.status??'skipped',dom:entry,
  }),
 }));
 return {validationLevel:'dom-only',pageTargetId:target.id,pageUrl:target.url,
  ...(pageDocumentToken?{pageDocumentToken}:{}),totalItems:items.length,items:validatedItems};
}
