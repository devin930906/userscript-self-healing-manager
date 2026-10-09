import type {ChromeTarget} from '../../cdp-client/src/index.ts';
import type {LiteralLocator,LocatorProbeResult} from '../../cdp-client/src/locator-probe.ts';
import {assertStablePageDocument,type ConfirmedPageIdentity} from '../../cdp-client/src/page-identity.ts';

export type ReadOnlyDomExpectation='exists'|'unique';
export type ReadOnlyDomVerdict='passed'|'failed'|'needs-review';
export interface ReadOnlyDomContractResult {
 readonly caseId:string;
 readonly expectation:ReadOnlyDomExpectation;
 readonly status:ReadOnlyDomVerdict;
 readonly reason:string;
 readonly matchCount:number|null;
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
function readCount(evidence:LocatorProbeResult,target:ChromeTarget,locator:LiteralLocator):number|null{
 if(evidence.targetId!==target.id||evidence.url!==target.url||
    evidence.validationLevel!=='dom-only'||!Array.isArray(evidence.checks)||
    evidence.checks.length!==1)return null;
 const check=evidence.checks[0];
 if(!check||check.method!==locator.method||check.expression!==locator.expression)return null;
 if(check.status==='missing'&&check.matchCount===0)return 0;
 if((check.status==='found'||check.status==='ambiguous')&&Number.isSafeInteger(check.matchCount)&&
    check.matchCount!==null&&check.matchCount>0&&check.matchCount<=5000)return check.matchCount;
 return null;
}
/** A unique count does not identify the same element across two CDP sessions.
 * The opt-in HMAC backendNodeId fingerprint proves single-node continuity
 * without revealing backend IDs or any private page content. */
function readUniqueIdentity(evidence:LocatorProbeResult,target:ChromeTarget,locator:LiteralLocator):string|null{
 if(evidence.targetId!==target.id||evidence.url!==target.url||
    evidence.checks.length!==1)return null;
 const check=evidence.checks[0];
 if(!check||check.method!==locator.method||check.expression!==locator.expression||
    check.status!=='found'||check.matchCount!==1)return null;
 const digest=check.nodeFingerprint;
 return typeof digest==='string'&&/^[0-9a-f]{64}$/.test(digest)?digest:null;
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
 if(!target||typeof target.id!=='string'||!target.id||target.id.length>128||
    !target.webSocketDebuggerUrl||!/^https?:\/\//i.test(target.url))throw new Error('Invalid CDP target');
 if(typeof caseId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(caseId))
  throw new Error('Invalid DOM test case id');
 if(expectation!=='exists'&&expectation!=='unique')throw new Error('Unsupported DOM contract');
 if(!locator||locator.runtimeRequired||!['querySelector','querySelectorAll','getElementById',
  'getElementsByClassName','getElementsByName'].includes(locator.method)||
  typeof locator.expression!=='string'||!locator.expression.trim()||locator.expression.length>1024)
  throw new Error('A supported static literal document selector is required');
 if(!deps||typeof deps.confirm!=='function'||typeof deps.probe!=='function'||typeof deps.wait!=='function')
  throw new Error('Invalid DOM test dependencies');
 const build=(status:ReadOnlyDomVerdict,reason:string,count:number|null,attempts:1|2):ReadOnlyDomContractResult=>({
  caseId,expectation,status,reason,matchCount:count,attempts,
  evidenceLevel:'V1',V2:'blocked',V3:'not-configured',V4:'not-configured',
  functionalVerified:false,managerVerified:false,
 });
 const baseline=await deps.confirm(target);
 if(baseline.targetId!==target.id||baseline.confirmedUrl!==target.url||
  !baseline.frameId||!baseline.loaderId)throw new Error('Unverified CDP document identity');
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
      if(evidence.targetId===target.id&&evidence.url===target.url&&
         Number.isSafeInteger(evidence.authorShadowTreeNodes)&&
         evidence.authorShadowTreeNodes>=0&&evidence.authorShadowTreeNodes<=200000)
       roots=evidence.authorShadowTreeNodes>0?'present':'absent';
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
