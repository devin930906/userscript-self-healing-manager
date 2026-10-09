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
export function summarizeLiveLocatorCheck(checks:readonly LiveLocatorCheck[]):LiveLocatorSummary{
 // querySelector() and getElementById() select one node. Collection APIs
 // legitimately return multiple matches. Never attest impossible, fractional,
 // or over-budget counts from an untrusted CDP response.
 const collections=new Set(['querySelectorAll','getElementsByClassName','getElementsByName']);
 const found=checks.filter(c=>c.status==='found'&&
  Number.isSafeInteger(c.matchCount)&&c.matchCount!==null&&
  c.matchCount>=1&&c.matchCount<=10_000&&
  (c.matchCount===1||c.method===undefined||collections.has(c.method))).length;
 const missing=checks.filter(c=>c.status==='missing'&&c.matchCount===0).length;
 const needsReview=checks.length-found-missing;
 const status=checks.length===0?'no-evidence':missing>0?'locator-missing':needsReview>0?'needs-review':'dom-present';
 return {status,total:checks.length,found,missing,needsReview,validationLevel:'dom-only'};
}
