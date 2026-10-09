/** Live CDP evidence summary; never a proof that a userscript ran correctly. */
export interface LiveLocatorCheck {readonly status:'found'|'missing'|'ambiguous'|'blocked'|'unverified';readonly matchCount:number|null}
export interface LiveLocatorSummary {
 readonly status:'locator-missing'|'needs-review'|'dom-present'|'no-evidence';
 readonly total:number;readonly found:number;readonly missing:number;readonly needsReview:number;
 readonly validationLevel:'dom-only';
}
export function summarizeLiveLocatorCheck(checks:readonly LiveLocatorCheck[]):LiveLocatorSummary{
 // CDP probe reports "found" only when exactly one element matches.
 // A contradictory count is unverified evidence, never a V1 success.
 const found=checks.filter(c=>c.status==='found'&&c.matchCount===1).length;
 const missing=checks.filter(c=>c.status==='missing'&&c.matchCount===0).length;
 const needsReview=checks.length-found-missing;
 const status=checks.length===0?'no-evidence':missing>0?'locator-missing':needsReview>0?'needs-review':'dom-present';
 return {status,total:checks.length,found,missing,needsReview,validationLevel:'dom-only'};
}
