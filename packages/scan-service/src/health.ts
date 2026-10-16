/** Live CDP evidence summary; never a proof that a userscript ran correctly. */
export interface LiveLocatorCheck {
 readonly status:'found'|'missing'|'ambiguous'|'blocked'|'unverified';
 readonly matchCount:number|null;
 /** Optional for legacy summaries; trusted batch probes always include method. */
 readonly method?:string;
}
export interface LiveLocatorSummary {
 readonly status:'locator-missing'|'needs-review'|'dom-present'|'no-evidence';
 readonly total:number;readonly found:number;readonly missing:number;readonly needsReview:number;
 readonly validationLevel:'dom-only';
}

// This must match the read-only CDP locator-probe asCss adapter. The static
// source analyzer recognizes additional JS APIs (closest, matches,
// getElementsByTagName) that the live CDP adapter cannot actually probe.
// Such methods must never earn V1 credit from a fabricated count.
const SUPPORTED_PROBE_METHODS=new Set([
 'querySelector','querySelectorAll','getElementById',
 'getElementsByName','getElementsByClassName',
]);
const COLLECTION_PROBE_METHODS=new Set([
 'querySelectorAll','getElementsByName','getElementsByClassName',
]);

function classifyCheck(input:unknown):'found'|'missing'|'review'{
 if(!input||typeof input!=='object'||Array.isArray(input))return 'review';
 let status:PropertyDescriptor|undefined;
 let count:PropertyDescriptor|undefined;
 let method:PropertyDescriptor|undefined;
 let inheritedMethod=false;
 try{
  status=Object.getOwnPropertyDescriptor(input,'status');
  count=Object.getOwnPropertyDescriptor(input,'matchCount');
  method=Object.getOwnPropertyDescriptor(input,'method');
  inheritedMethod=!method&&'method' in input;
 }catch{return 'review';}
 // A remote or untrusted receipt must not execute arbitrary accessors when
 // the summary is constructed, including getters inherited via prototypes.
 if(!status||!('value' in status)||!count||!('value' in count)||
    (method&&!('value' in method))||inheritedMethod)return 'review';
 const methodValue=method?.value as unknown;
 if(methodValue!==undefined&&
    (typeof methodValue!=='string'||!SUPPORTED_PROBE_METHODS.has(methodValue)))
  return 'review';
 const matchCount=count.value as unknown;
 if(status.value==='found'&&Number.isSafeInteger(matchCount)&&
    typeof matchCount==='number'&&matchCount>=1&&matchCount<=10_000&&
    (matchCount===1||methodValue===undefined||
     COLLECTION_PROBE_METHODS.has(methodValue as string)))
  return 'found';
 if(status.value==='missing'&&matchCount===0)return 'missing';
 return 'review';
}

export function summarizeLiveLocatorCheck(checks:readonly LiveLocatorCheck[]):LiveLocatorSummary{
 let found=0,missing=0;
 // Array holes and invalid rows count toward needsReview; never count them
 // as a successful probe or silently shrink the denominator.
 for(let index=0;index<checks.length;index++){
  const classification=classifyCheck(checks[index]);
  if(classification==='found')found++;
  else if(classification==='missing')missing++;
 }
 const needsReview=checks.length-found-missing;
 const status=checks.length===0?'no-evidence':missing>0?'locator-missing':needsReview>0?'needs-review':'dom-present';
 return {status,total:checks.length,found,missing,needsReview,validationLevel:'dom-only'};
}
