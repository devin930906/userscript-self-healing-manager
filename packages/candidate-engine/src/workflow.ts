import {rankSelectorCandidates,type SafeDomNode,type SelectorCandidate} from './index.ts';
import {assertStablePageDocument,type ConfirmedPageIdentity} from '../../cdp-client/src/page-identity.ts';
import {resolveSiteAdapterRole,type SiteAdapter,type AdapterRoleResolution} from './site-adapter.ts';
export interface MissingLocator {method:string;expression:string;runtimeRequired:boolean}
export interface DomProbeCheck {method:string;expression:string;status:string;matchCount:number|null}
export interface DomProbeEvidence {targetId:string;url:string;checks:readonly DomProbeCheck[]}
export interface SafeSnapshotEvidence {targetId:string;url:string;scope:string;nodes:readonly SafeDomNode[]}
export type VerifiedCandidate=Omit<SelectorCandidate,'validationLevel'>&{validationLevel:'dom-candidate-verified'};
export interface CandidateDeps {
 /** Required: no selector recommendation may be certified without Frame/Loader identity. */
 confirm:()=>Promise<ConfirmedPageIdentity>;
 probe:(locators:readonly MissingLocator[])=>Promise<DomProbeEvidence>;
 capture:()=>Promise<SafeSnapshotEvidence>;
}
function ensureIdentity(expected:{id:string;url:string},actual:{targetId:string;url:string}){
 if(expected.id!==actual.targetId||expected.url!==actual.url)throw new Error('CDP page identity changed during candidate inspection');
}
/** Require two independent live CDP DOM checks; suggestions always need manual approval. */
export async function suggestCandidateRepairs({target,locator,deps}:{target:{id:string;url:string};locator:MissingLocator;deps:CandidateDeps}):Promise<VerifiedCandidate[]>{
 if(!['querySelector','getElementById','getElementsByName','getElementsByClassName'].includes(locator.method)||locator.runtimeRequired||!locator.expression||locator.expression.length>1024)return [];
 if(!deps||typeof deps.confirm!=='function')
  throw new Error('Candidate CDP document identity confirmation is required');
 const confirmStable=async(baseline:ConfirmedPageIdentity):Promise<void>=>{
  const identity=await deps.confirm!();
  if(identity.targetId!==target.id||identity.confirmedUrl!==target.url||
     !identity.frameId||!identity.loaderId||
     identity.frameId.length>256||identity.loaderId.length>256)
   throw new Error('Unverified candidate CDP page document identity');
  assertStablePageDocument(baseline,identity);
 };
 let baseline:ConfirmedPageIdentity|null=null;
 if(deps.confirm){
  baseline=await deps.confirm();
  if(baseline.targetId!==target.id||baseline.confirmedUrl!==target.url||
     !baseline.frameId||!baseline.loaderId||
     baseline.frameId.length>256||baseline.loaderId.length>256)
   throw new Error('Unverified candidate CDP page document identity');
 }
 const originalProbe=await deps.probe([locator]);ensureIdentity(target,originalProbe);
 if(baseline)await confirmStable(baseline);
 const old=originalProbe.checks[0];
 if(originalProbe.checks.length!==1||old?.expression!==locator.expression||old.method!==locator.method||old.status!=='missing'||old.matchCount!==0)return [];
 const snapshot=await deps.capture();ensureIdentity(target,snapshot);
 if(baseline)await confirmStable(baseline);
 if(snapshot.scope!=='top-document')throw new Error('Only top-document DOM evidence is supported');
 const ranked=rankSelectorCandidates({method:locator.method,oldSelector:locator.expression,nodes:snapshot.nodes});
 if(!ranked.length)return [];
 // The snapshot and candidate probing are separate CDP round trips. Confirm
 // the broken selector has not transiently recovered before we probe fixes.
 const preCandidateOriginal=await deps.probe([locator]);
 ensureIdentity(target,preCandidateOriginal);
 if(baseline)await confirmStable(baseline);
 const preCheck=preCandidateOriginal.checks[0];
 if(preCandidateOriginal.checks.length!==1||preCheck?.method!==locator.method||
    preCheck.expression!==locator.expression||preCheck.status!=='missing'||preCheck.matchCount!==0)return [];
 // Untrusted ranking inputs must never amplify a single DOM snapshot into an
 // unbounded sequence of browser probes.
 if(ranked.length>10)throw new Error('Candidate verification exceeds ranking limit');
 const confirmation=await deps.probe(ranked.map(candidate=>({method:locator.method,expression:candidate.expression,runtimeRequired:false})));
 ensureIdentity(target,confirmation);
 if(baseline)await confirmStable(baseline);
 if(confirmation.checks.length!==ranked.length)throw new Error('CDP returned partial candidate confirmation');
 // Dynamic pages can change between capture and verification. Require a
 // second independent probe before presenting a selector as live-verified.
 const repeat=await deps.probe(ranked.map(candidate=>({method:locator.method,expression:candidate.expression,runtimeRequired:false})));
 ensureIdentity(target,repeat);
 if(baseline)await confirmStable(baseline);
 if(repeat.checks.length!==ranked.length)throw new Error('CDP returned partial repeated candidate confirmation');
 // If the original selector recovered during inspection, recommending a
 // replacement would be misleading. The original failure must still exist.
 const finalOriginal=await deps.probe([locator]);
 ensureIdentity(target,finalOriginal);
 if(baseline)await confirmStable(baseline);
 const finalCheck=finalOriginal.checks[0];
 if(finalOriginal.checks.length!==1||finalCheck?.expression!==locator.expression||
    finalCheck.method!==locator.method||finalCheck.status!=='missing'||finalCheck.matchCount!==0)return [];
 const verified:VerifiedCandidate[]=[];
 const seen=new Set<string>();
 for(let i=0;i<ranked.length;i++){
  const a=ranked[i]!,b=confirmation.checks[i]!;
  const c=repeat.checks[i]!;
  if(b.expression===a.expression&&b.method===locator.method&&b.status==='found'&&b.matchCount===1&&
     c.expression===a.expression&&c.method===locator.method&&c.status==='found'&&c.matchCount===1&&
     !seen.has(a.expression)){
   seen.add(a.expression);
   verified.push({...a,validationLevel:'dom-candidate-verified'});
  }
 }
 return verified;
}


export type AdapterScopedRepairsResult=AdapterRoleResolution&{
 readonly candidates:readonly VerifiedCandidate[];
};
/**
 * A versioned semantic role narrows, never broadens, the ordinary two-step
 * live DOM candidate probe. The role's local selectors cannot turn candidate
 * evidence into V2 interaction / V3 functional / V4 manager verification.
 */
export async function suggestAdapterScopedRepairs({target,locator,adapter,roleId,observedStateId,deps}:{
 target:{id:string;url:string};
 locator:MissingLocator;
 adapter:SiteAdapter;
 roleId:string;
 observedStateId:string|null;
 deps:CandidateDeps;
}):Promise<AdapterScopedRepairsResult>{
 const role=resolveSiteAdapterRole({adapter,pageUrl:target.url,roleId,observedStateId});
 // Existing candidate capture is top-document-only. Never match selectors
 // declared inside a ShadowRoot against unrelated top-document nodes.
 if(role.status!=='candidate-only'||role.rootScope!=='document')return {...role,candidates:[]};
 const allowed=new Map(role.selectors.map((css,index)=>[css,index]));
 const suggestions=await suggestCandidateRepairs({target,locator,deps});
 const permitted=suggestions.filter(candidate=>allowed.has(candidate.cssSelector));
 permitted.sort((a,b)=>allowed.get(a.cssSelector)!-allowed.get(b.cssSelector)!);
 return {...role,candidates:permitted};
}
