import type {ChromeTarget} from '../../cdp-client/src/index.ts';
import {asCss,type LiteralLocator,type LocatorProbeResult} from '../../cdp-client/src/locator-probe.ts';
import {assertStablePageDocument,type ConfirmedPageIdentity} from '../../cdp-client/src/page-identity.ts';
import {validateCdpPageSocket} from '../../cdp-client/src/endpoint.ts';
import {assertCredentialFreePageUrl} from '../../cdp-client/src/page-url-safety.ts';

export type ReadOnlyDomExpectation='exists'|'unique'|'count-changed';
export type ReadOnlyDomVerdict='passed'|'failed'|'needs-review';
export interface ReadOnlyDomContractResult {
 readonly caseId:string;
 readonly expectation:ReadOnlyDomExpectation;
 readonly status:ReadOnlyDomVerdict;
 readonly reason:string;
 readonly matchCount:number|null;
 /** First trusted DOM sample for a completed count-change assertion; otherwise null. */
 readonly initialMatchCount:number|null;
 readonly attempts:1|2;
 readonly evidenceLevel:'V1';
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
 readonly functionalVerified:false;
 readonly managerVerified:false;
}
export interface ReadOnlyDomContractDeps {
 confirm:(target:ChromeTarget)=>Promise<ConfirmedPageIdentity>;
 probe:(target:ChromeTarget,locators:readonly LiteralLocator[])=>Promise<LocatorProbeResult>;
 wait:()=>Promise<void>;
 /** Read-only snapshot of author Shadow Roots, never DOM text or arbitrary JS. */
 summarize?:(target:ChromeTarget)=>Promise<{targetId:string;url:string;authorShadowTreeNodes:number}>;
}
/** CDP adapter returns decoded data, not trusted JavaScript objects. A
 * prototype, getter, sparse array slot or proxy cannot certify a V1 result.
 * Never include raw site/adapter exception details in a user verdict. */
function ownEvidenceField(value:unknown,key:string):unknown{
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 try{
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 }catch{return undefined;}
}
function readOwnLocatorRow(evidence:LocatorProbeResult,target:ChromeTarget,locator:LiteralLocator):unknown{
 if(ownEvidenceField(evidence,'targetId')!==target.id||
    ownEvidenceField(evidence,'url')!==target.url||
    ownEvidenceField(evidence,'validationLevel')!=='dom-only')return undefined;
 const checks=ownEvidenceField(evidence,'checks');
 if(!Array.isArray(checks)||checks.length!==1)return undefined;
 let check:unknown;
 try{
  const first=Object.getOwnPropertyDescriptor(checks,'0');
  if(!first||!Object.hasOwn(first,'value'))return undefined;
  check=first.value;
 }catch{return undefined;}
 if(ownEvidenceField(check,'method')!==locator.method||
    ownEvidenceField(check,'expression')!==locator.expression)return undefined;
 return check;
}
function readCount(evidence:LocatorProbeResult,target:ChromeTarget,locator:LiteralLocator):number|null{
 const check=readOwnLocatorRow(evidence,target,locator);
 if(!check)return null;
 const status=ownEvidenceField(check,'status');
 const matchCount=ownEvidenceField(check,'matchCount');
 if(status==='missing'&&matchCount===0)return 0;
 if(status==='found'&&typeof matchCount==='number'&&
    Number.isSafeInteger(matchCount)&&matchCount>0&&matchCount<=5000){
  // CDP collections legitimately have many matches; single-node APIs don't.
  if((locator.method==='querySelector'||locator.method==='getElementById')&&
     matchCount!==1)return null;
  return matchCount;
 }
 return null;
}
/** Two identical counts cannot identify an identical DOM node. Only an OWN
 * fixed-length HMAC fingerprint can establish two-sample node continuity. */
function readUniqueIdentity(evidence:LocatorProbeResult,target:ChromeTarget,locator:LiteralLocator):string|null{
 const check=readOwnLocatorRow(evidence,target,locator);
 if(!check||ownEvidenceField(check,'status')!=='found'||
    ownEvidenceField(check,'matchCount')!==1)return null;
 const digest=ownEvidenceField(check,'nodeFingerprint');
 return typeof digest==='string'&&/^[0-9a-f]{64}$/.test(digest)?digest:null;
}
/** Match the bounded frame/loader evidence accepted at the batch scan boundary.
 * Never promote a malformed injected confirmation to a V1 locator verdict. */
export function assertBoundedFrameIdentity(identity:ConfirmedPageIdentity):void {
 if(!identity||typeof identity.frameId!=='string'||!identity.frameId||
    identity.frameId.length>256||typeof identity.loaderId!=='string'||
    !identity.loaderId||identity.loaderId.length>256)
  throw new Error('Unverified CDP document identity: invalid frame or loader');
 const count=identity.subframeCount;
 if(count!==undefined&&(!Number.isSafeInteger(count)||count<0||count>64))
  throw new Error('Unverified CDP document identity: invalid frame count');
 const child=identity.soleSameOriginSubframe;
 if(child!==undefined&&
    (count!==1||!child||typeof child.frameId!=='string'||!child.frameId||
     child.frameId.length>256||child.frameId===identity.frameId||
     typeof child.loaderId!=='string'||!child.loaderId||child.loaderId.length>256||
     (child.urlFingerprint!==undefined&&
      (typeof child.urlFingerprint!=='string'||!/^[0-9a-f]{64}$/.test(child.urlFingerprint)))))
  throw new Error('Unverified CDP document identity: invalid child frame');
}
/** A named, non-destructive locator-level assertion, never functional userscript validation. */
export async function runReadOnlyDomContract({approved,target,caseId,locator,expectation,deps}:{
 readonly approved:boolean;
 readonly target:ChromeTarget;
 readonly caseId:string;
 readonly locator:LiteralLocator;
 readonly expectation:ReadOnlyDomExpectation;
 readonly deps:ReadOnlyDomContractDeps;
}):Promise<ReadOnlyDomContractResult>{
 if(approved!==true)throw new Error('Explicit DOM contract approval required');
 if(!target||target.type!=='page'||typeof target.id!=='string'||!target.id||target.id.length>128||
    typeof target.url!=='string'||!/^https?:\/\//i.test(target.url))throw new Error('Invalid CDP target');
 assertCredentialFreePageUrl(target.url);
 // The contract is a public orchestration boundary: do not assume an
 // injected confirm/probe adapter checked the CDP target before being called.
 validateCdpPageSocket(target);
 if(typeof caseId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(caseId))
  throw new Error('Invalid DOM test case id');
 if(expectation!=='exists'&&expectation!=='unique'&&expectation!=='count-changed')
  throw new Error('Unsupported DOM contract');
 if(!locator||locator.runtimeRequired||!['querySelector','querySelectorAll','getElementById',
  'getElementsByClassName','getElementsByName'].includes(locator.method)||
  typeof locator.expression!=='string'||!locator.expression.trim()||locator.expression.length>1024||
  asCss(locator)===null)
  throw new Error('A supported static literal document selector is required');
 if(!deps||typeof deps.confirm!=='function'||typeof deps.probe!=='function'||typeof deps.wait!=='function')
  throw new Error('Invalid DOM test dependencies');
 const build=(status:ReadOnlyDomVerdict,reason:string,count:number|null,attempts:1|2,initialMatchCount:number|null=null):ReadOnlyDomContractResult=>({
  caseId,expectation,status,reason,matchCount:count,initialMatchCount,attempts,
  evidenceLevel:'V1',V2:'blocked',V3:'not-configured',V4:'not-configured',
  functionalVerified:false,managerVerified:false,
 });
 const baseline=await deps.confirm(target);
 assertBoundedFrameIdentity(baseline);
 if(baseline.targetId!==target.id||baseline.confirmedUrl!==target.url)
  throw new Error('Unverified CDP document identity');
 let nestedFramesSeen=(baseline.subframeCount??0)>0;
 const guard=async()=>{
  const confirmed=await deps.confirm(target);
  assertStablePageDocument(baseline,confirmed);
  if((confirmed.subframeCount??0)>0)nestedFramesSeen=true;
 };
 let first:number|null=null;
 let firstIdentity:string|null=null;
 for(let attempt=1;attempt<=2;attempt++){
  await guard();
  let evidence:LocatorProbeResult|undefined;
  let probeError=false;
  try{evidence=await deps.probe(target,[locator]);}
  catch{probeError=true;}
  await guard();
  const count=probeError||!evidence?null:readCount(evidence,target,locator);
  if(count===null)return build('needs-review','CDP observation was unavailable or inconsistent',null,attempt as 1|2);
  // "unique" must prove *the same node* across two independent snapshots.
  // This is deliberately stronger than the count-only "exists" contract.
  const identity=expectation==='unique'&&count===1&&evidence?
   readUniqueIdentity(evidence,target,locator):null;
  if(expectation==='unique'&&count===1&&!identity)
   return build('needs-review','Unique DOM node identity was absent or invalid',null,attempt as 1|2);
  if(attempt===1){
   first=count;
   firstIdentity=identity;
   try{await deps.wait();}
   catch{
    await guard();
    return build('needs-review','Bounded DOM wait was interrupted',null,1);
   }
   await guard();
  }else{
   if(expectation==='count-changed'){
    // This proves only a top-document count transition in two read-only
    // samples. It cannot attribute the change to a userscript, interaction,
    // business outcome, extension injection or any GM_* API.
    return build(first!==count?'passed':'failed',
     first!==count?'Top-document DOM match count changed between two read-only samples; no userscript behavior verified':
     'Top-document DOM match count did not change between two read-only samples',
     count,2,first);
   }
   if(first!==count)return build('needs-review','DOM match count was unstable between samples',null,2);
   if(expectation==='unique'&&count===1&&firstIdentity!==identity)
    return build('needs-review','Unique DOM node identity changed between samples',null,2);
   const passed=expectation==='exists'?count>0:count===1;
   if(!passed&&count===0){
    // A top-document miss is not evidence that a userscript fails when
    // its target may be inside an iframe or an author ShadowRoot. Missing
    // context evidence also fails closed rather than certifying absence.
    let roots:'absent'|'present'|'unknown'='unknown';
    if(deps.summarize){
     try{
      const evidence=await deps.summarize(target);
      await guard();
      const shadowCount=ownEvidenceField(evidence,'authorShadowTreeNodes');
      if(ownEvidenceField(evidence,'targetId')===target.id&&
         ownEvidenceField(evidence,'url')===target.url&&
         typeof shadowCount==='number'&&Number.isSafeInteger(shadowCount)&&
         shadowCount>=0&&shadowCount<=200000)
       roots=shadowCount>0?'present':'absent';
     }catch{await guard();}
    }
    if(nestedFramesSeen||roots!=='absent'){
     const reasons=[
      nestedFramesSeen?'iframe contexts were not inspected':null,
      roots==='present'?'Author Shadow DOM may contain the locator':null,
      roots==='unknown'?'Shadow DOM context cannot be verified':null,
     ].filter(Boolean);
     return build('needs-review',reasons.join('; '),null,2);
    }
   }
   return build(passed?'passed':'failed',
    passed?'Named read-only DOM assertion matched twice':
     count===0?'Locator was absent in both confirmed top-document observations':'Unique locator matched multiple elements',
    count,2);
  }
 }
 // Reaching here would violate the fixed two-sample bound.
 throw new Error('Invalid DOM contract state');
}
