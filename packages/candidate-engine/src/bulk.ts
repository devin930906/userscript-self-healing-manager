import {assertStablePageDocument} from '../../cdp-client/src/page-identity.ts';
import {suggestCandidateRepairs,type CandidateDeps,type DomProbeCheck,type MissingLocator,type VerifiedCandidate} from './workflow.ts';

export interface BulkCandidateItem {
 readonly selectorIndex:number;readonly method:string;readonly oldSelector:string;
 readonly candidates:readonly VerifiedCandidate[];
}
export interface BulkCandidateResult {
 readonly validationLevel:'dom-only';readonly pageTargetId:string;readonly pageUrl:string;
 readonly totalMissing:number;readonly checkedMissing:number;readonly remainingMissing:number;readonly candidateOffset:number;
 readonly items:readonly BulkCandidateItem[];
}
const SUPPORTED=new Set(['querySelector','getElementById','getElementsByName','getElementsByClassName']);
/** Bounded, read-only candidate discovery. No JS injection, script execution or edits. */
export async function suggestMissingCandidatesBulk({target,locators,checks,deps,evidenceIdentity,offset=0}:{
 target:{id:string;url:string};
 locators:readonly MissingLocator[];
 checks:readonly DomProbeCheck[];
 deps:CandidateDeps;
 evidenceIdentity?:{targetId:string;url:string};
 offset?:number|undefined;
}):Promise<BulkCandidateResult>{
 if(!target.id||!/^https?:\/\//i.test(target.url))throw new Error('Invalid selected page identity');
 if(!Number.isSafeInteger(offset)||offset<0||offset>48||offset%8!==0)throw new Error('Invalid candidate offset');
 if(evidenceIdentity&&(evidenceIdentity.targetId!==target.id||evidenceIdentity.url!==target.url))
  throw new Error('Initial CDP page identity mismatch');
 if(locators.length>50||locators.length!==checks.length)throw new Error('Unbounded or partial locator probe evidence');
 const eligible:number[]=[];
 for(let i=0;i<locators.length;i++){
  const locator=locators[i]!,check=checks[i]!;
  if(locator.method!==check.method||locator.expression!==check.expression)
   throw new Error('Locator probe evidence shape mismatch');
  if(check.status==='missing'&&check.matchCount===0&&!locator.runtimeRequired&&
    SUPPORTED.has(locator.method)&&locator.expression.length<=1024&&locator.expression)
   eligible.push(i);
 }
 // Individual locator checks pin their own loader, but a batch must not
 // combine suggestions from two successive documents under the same URL.
 const baseline=await deps.confirm();
 if(baseline.targetId!==target.id||baseline.confirmedUrl!==target.url||
    !baseline.frameId||!baseline.loaderId)
  throw new Error('Unverified batch CDP document identity');
 const assertBatchDocument=async()=>{
  const current=await deps.confirm();
  assertStablePageDocument(baseline,current);
 };
 const results:BulkCandidateItem[]=[];
 const usedExpressions=new Set<string>();
 for(const i of eligible.slice(offset,offset+8)){
  const locator=locators[i]!;
  await assertBatchDocument();
  const suggestions=await suggestCandidateRepairs({target,locator,deps});
  await assertBatchDocument();
  const candidates=suggestions.filter(candidate=>{
   if(usedExpressions.has(locator.method+'|'+candidate.expression))return false;
   usedExpressions.add(locator.method+'|'+candidate.expression);
   return true;
  });
  results.push({selectorIndex:i,method:locator.method,oldSelector:locator.expression,candidates});
 }
 await assertBatchDocument();
 return {validationLevel:'dom-only',pageTargetId:target.id,pageUrl:target.url,
  totalMissing:eligible.length,checkedMissing:Math.min(eligible.length,offset+results.length),remainingMissing:Math.max(0,eligible.length-offset-results.length),candidateOffset:offset,
  items:results};
}
