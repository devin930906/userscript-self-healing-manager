import type {ScanItemResult} from './index.ts';
import type {ChromeTarget} from '../../cdp-client/src/index.ts';
import type {LiteralLocator,LocatorProbeResult} from '../../cdp-client/src/locator-probe.ts';
import type {ConfirmedPageIdentity} from '../../cdp-client/src/page-identity.ts';
import {checkUserscriptPageScope} from '../../candidate-engine/src/page-scope.ts';
import {summarizeLiveLocatorCheck} from './health.ts';

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
}
export interface BatchDomResult {
 readonly validationLevel:'dom-only';
 readonly pageTargetId:string;
 readonly pageUrl:string;
 readonly totalItems:number;
 readonly items:readonly BatchDomItem[];
}
export interface BatchDomDependencies {
 confirm:(target:ChromeTarget)=>Promise<ConfirmedPageIdentity>;
 probe:(target:ChromeTarget,locators:readonly LiteralLocator[])=>Promise<LocatorProbeResult>;
}
function assertPageIdentity(target:ChromeTarget,evidence:{targetId:string;confirmedUrl?:string;url?:string}):void {
 if(evidence.targetId!==target.id||(evidence.confirmedUrl??evidence.url)!==target.url)
  throw new Error('CDP page identity or live frame URL changed during batch diagnosis');
}
function errorMessage(error:unknown):string {
 return error instanceof Error?error.message.slice(0,250):'CDP diagnosis failed';
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
 if(!target.id||!target.webSocketDebuggerUrl||!/^https?:\/\//i.test(target.url))throw new Error('Invalid CDP page target');
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
   results.push({...common,status:'out-of-scope',checked:0,found:0,missing:0,needsReview:0,reason:scope.reason});
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
  assertPageIdentity(target,await deps.confirm(target));
  let evidence:LocatorProbeResult;
  try{evidence=await deps.probe(target,locators);}
  catch(error){
   results.push({...common,status:'error',checked:0,found:0,missing:0,needsReview:0,reason:errorMessage(error)});
   continue;
  }
  assertPageIdentity(target,await deps.confirm(target));
  if(evidence.targetId!==target.id||evidence.url!==target.url||evidence.validationLevel!=='dom-only'||
    evidence.checks.length!==locators.length||evidence.checks.some((check,i)=>check.method!==locators[i]!.method||check.expression!==locators[i]!.expression)){
   results.push({...common,status:'error',checked:0,found:0,missing:0,needsReview:0,reason:'CDP evidence identity or shape mismatch'});
   continue;
  }
  const summary=summarizeLiveLocatorCheck(evidence.checks);
  results.push({...common,status:summary.status,checked:summary.total,found:summary.found,missing:summary.missing,needsReview:summary.needsReview});
 }
 return {validationLevel:'dom-only',pageTargetId:target.id,pageUrl:target.url,totalItems:items.length,items:results};
}
