import {resolveSiteAdapterRole,type SiteAdapter} from '../../candidate-engine/src/site-adapter.ts';
import type {ChromeTarget} from '../../cdp-client/src/index.ts';
import type {ConfirmedPageIdentity} from '../../cdp-client/src/page-identity.ts';
import {assertStablePageDocument} from '../../cdp-client/src/page-identity.ts';
import type {LiteralLocator,LocatorProbeResult} from '../../cdp-client/src/locator-probe.ts';

export type RoleDomStatus='matched-v1'|'absent-v1'|'needs-review'|'out-of-scope'|'blocked-context'|'unknown-role';
export interface RoleDomResult {
 readonly siteId:string;readonly roleId:string;readonly version:string;
 readonly declaredStateId:string|null;readonly declaredStateVerified:false;
 readonly status:RoleDomStatus;
 readonly matchedSelector:string|null;
 readonly evidenceLevel:'V1'|'none';
 readonly V2:'blocked';readonly V3:'not-configured';readonly V4:'not-configured';
 readonly functionalVerified:false;readonly managerVerified:false;
 readonly reason:string;
 readonly samples:0|1|2;
}
export interface RoleCheckDeps {
 confirm:(target:ChromeTarget)=>Promise<ConfirmedPageIdentity>;
 probe:(target:ChromeTarget,locators:readonly LiteralLocator[])=>Promise<LocatorProbeResult>;
 probeOpenShadow?:(target:ChromeTarget,locators:readonly LiteralLocator[])=>Promise<LocatorProbeResult>;
 probeIframe?:(target:ChromeTarget,locators:readonly LiteralLocator[],frameId:string)=>Promise<LocatorProbeResult>;
 wait:()=>Promise<void>;
 summarize:(target:ChromeTarget)=>Promise<{targetId:string;url:string;authorShadowTreeNodes:number}>;
}
type LocatorSample={count:number;fingerprint:string|null};
type Counts=LocatorSample[]|null;
function counts(evidence:LocatorProbeResult,target:ChromeTarget,locators:readonly LiteralLocator[]):Counts{
 if(!evidence||evidence.targetId!==target.id||evidence.url!==target.url||
    evidence.validationLevel!=='dom-only'||!Array.isArray(evidence.checks)||
    evidence.checks.length!==locators.length)return null;
 const result:LocatorSample[]=[];
 for(let i=0;i<locators.length;i++){
  const locator=locators[i]!,c=evidence.checks[i];
  if(!c||c.method!==locator.method||c.expression!==locator.expression||
    !Number.isSafeInteger(c.matchCount)||c.matchCount===null||
    c.matchCount<0||c.matchCount>10000)return null;
  if(c.matchCount===0&&c.status!=='missing')return null;
  // Role strategies always probe querySelectorAll. The CDP client reports
  // any positive collection result as "found", never "ambiguous": accepting
  // ambiguous with one or more nodes would upgrade contradictory evidence.
  if(c.matchCount>0&&c.status!=='found')return null;
  // Every matched element needs an independently confirmed backend-node
  // identity. Compare canonical sets because DOM order can change without
  // element replacement. Missing/duplicated/over-budget sets fail closed.
  let fingerprint:string|null=null;
  if(c.matchCount===1){
   if(typeof c.nodeFingerprint!=='string'||!/^[0-9a-f]{64}$/.test(c.nodeFingerprint))return null;
   fingerprint=c.nodeFingerprint;
  }else if(c.matchCount>1){
   const values=c.nodeFingerprints;
   if(c.matchCount>10||!Array.isArray(values)||values.length!==c.matchCount||
      values.some(v=>typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))||
      new Set(values).size!==values.length)return null;
   fingerprint=[...values].sort().join(':');
  }
  result.push({count:c.matchCount,fingerprint});
 }
 return result;
}
/**
 * V1-only, read-only and state-declared (never state-attested) semantic role
 * assessment. Distinct fallback CSS selectors could refer to different nodes,
 * so two selectors matching is not accepted as a unique semantic target.
 */
export async function runSiteAdapterRoleDomCheck({
 approved,target,adapter,roleId,declaredStateId,deps,
}:{
 approved:boolean;target:ChromeTarget;adapter:SiteAdapter;
 roleId:string;declaredStateId:string|null;deps:RoleCheckDeps;
}):Promise<RoleDomResult>{
 if(approved!==true)throw new Error('Explicit SiteAdapter DOM consent/approval required');
 if(!target||typeof target.id!=='string'||!target.id||target.id.length>128||
    typeof target.url!=='string'||!target.webSocketDebuggerUrl)
  throw new Error('Invalid SiteAdapter CDP target');
 const base={
  siteId:adapter.siteId,roleId,version:adapter.version,declaredStateId,
  declaredStateVerified:false as const,V2:'blocked' as const,
  V3:'not-configured' as const,V4:'not-configured' as const,
  functionalVerified:false as const,managerVerified:false as const,
 };
 const result=(status:RoleDomStatus,reason:string,matchedSelector:string|null=null,samples:0|1|2=0):RoleDomResult=>({
  ...base,status,reason,matchedSelector,samples,
  evidenceLevel:status==='matched-v1'||status==='absent-v1'?'V1':'none',
 });
 // The state comes from the user, not from a website runtime assertion.
 // Unknown/iframe/ShadowRoot scope blocks BEFORE opening CDP.
 const role=resolveSiteAdapterRole({adapter,pageUrl:target.url,roleId,observedStateId:declaredStateId});
 if(role.status!=='candidate-only')return result(role.status,'Adapter site/state/frame/shadow definition not inspectable by supported read-only CDP');
 // Shadow evidence is explicit. Never reuse the top-document locator probe
 // for a role declared inside an open ShadowRoot.
 if(role.rootScope==='open-shadow'&&typeof deps?.probeOpenShadow!=='function')
  return result('blocked-context','No trusted open ShadowRoot CDP probe configured');
 if(role.rootScope==='iframe-document'&&typeof deps?.probeIframe!=='function')
  return result('blocked-context','No trusted iframe document CDP probe configured');
 if(!deps||typeof deps.confirm!=='function'||typeof deps.probe!=='function'||
    typeof deps.wait!=='function'||typeof deps.summarize!=='function')
  throw new Error('Invalid SiteAdapter DOM inspection dependencies');
 const locators:LiteralLocator[]=role.selectors.map(expression=>({
  method:'querySelectorAll',expression,runtimeRequired:false,
 }));
 if(!locators.length||locators.length>10)throw new Error('Invalid SiteAdapter strategy budget');
 const baseline=await deps.confirm(target);
 if(baseline.targetId!==target.id||baseline.confirmedUrl!==target.url||!baseline.frameId||!baseline.loaderId)
  throw new Error('CDP page identity not verified for SiteAdapter');
 const iframe=baseline.soleSameOriginSubframe;
 if(role.rootScope==='iframe-document'&&
    ((baseline.subframeCount??0)!==1||!iframe?.frameId||!iframe.loaderId||
     !/^[0-9a-f]{64}$/.test(iframe.urlFingerprint??'')))
  return result('blocked-context','Exactly one same-origin child frame with a pinned loader and private URL identity is required');
 let subframes=(baseline.subframeCount??0)>0;
 const guard=async()=>{
  const current=await deps.confirm(target);
  assertStablePageDocument(baseline,current);
  if((current.subframeCount??0)>0)subframes=true;
 };
 const inspect=async():Promise<Counts>=>{
  await guard();
  let observation:LocatorProbeResult|undefined;
  try{
   if(role.rootScope==='open-shadow')observation=await deps.probeOpenShadow!(target,locators);
   else if(role.rootScope==='iframe-document')observation=await deps.probeIframe!(target,locators,iframe!.frameId);
   else observation=await deps.probe(target,locators);
  }
  catch{await guard();return null;}
  await guard();
  return counts(observation!,target,locators);
 };
 const first=await inspect();
 if(first===null)return result('needs-review','First read-only CDP observation unavailable',null,1);
 try{await deps.wait();}catch{await guard();return result('needs-review','Bounded DOM resampling interrupted',null,1);}
 const second=await inspect();
 if(second===null||first.some((sample,i)=>sample.count!==second[i]?.count||sample.fingerprint!==second[i]?.fingerprint))
  return result('needs-review','DOM selector evidence incomplete or unstable',null,2);
 const matching=second.map((sample,i)=>({n:sample.count,i})).filter(x=>x.n>0);
 if(matching.length>1)return result('needs-review','Multiple fallback locators matched: element identity cannot be proven',null,2);
 if(matching.length===1){
  const {n,i}=matching[0]!,cardinality=adapter.roles[roleId]!.cardinality;
  if(n<cardinality.min||n>cardinality.max)
   return result('needs-review','DOM matches violate role cardinality',null,2);
  // Single and multi-element roles both require complete, stable backend
  // identity sets before this branch is reached.
  return result('matched-v1','Declared-state scoped DOM selector count and backend node identity matched twice, not a script functional pass',locators[i]!.expression,2);
 }
 // A top-document absence cannot exclude nested browsing contexts or author
 // shadow roots. Context snapshots must be verifiable and within budget.
 if(role.rootScope==='open-shadow')
  return result('needs-review','No stable match in the selected open ShadowRoot; complex/nested contexts are not excluded',null,2);
 if(role.rootScope==='iframe-document')
  return result('needs-review','No stable match in the one pinned iframe document; nested Shadow DOM remains unknown',null,2);
 if(subframes)return result('needs-review','Possible matches inside iframe contexts',null,2);
 try{
  const ctx=await deps.summarize(target);
  await guard();
  if(ctx.targetId!==target.id||ctx.url!==target.url||
     !Number.isSafeInteger(ctx.authorShadowTreeNodes)||ctx.authorShadowTreeNodes<0||
     ctx.authorShadowTreeNodes>200000)
   return result('needs-review','Cannot validate ShadowRoot context',null,2);
  if(ctx.authorShadowTreeNodes>0)
   return result('needs-review','Author Shadow DOM may contain a matching locator',null,2);
 }catch(error){
  await guard();
  return result('needs-review','Cannot inspect ShadowRoot context',null,2);
 }
 return result('absent-v1','Both top-document CDP samples had no matching selector; userscript functional state unknown',null,2);
}
