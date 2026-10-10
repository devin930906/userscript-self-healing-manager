import {validateCdpPageSocket} from '../packages/cdp-client/src/endpoint.ts';

/**
 * CI / disposable localhost fixture only. This MUST NOT be imported into
 * Electron production code or accept an arbitrary userscript / website.
 *
 * A named synthetic end-to-end functional contract is useful for detecting
 * regressions in the repair pipeline. It is NOT production V3, a manager
 * attestation or proof of Tampermonkey GM_* execution.
 */
const HEADER='// ==UserScript==\n// @name Local CDP Smoke\n// @match http://127.0.0.1/*\n// ==/UserScript==\n';
const TAIL='if(actionButton&&targetPane){actionButton.setAttribute("data-usshm-functional","pass");targetPane.setAttribute("data-usshm-functional","pass");}\n'
 +'if(!document.getElementById("usshm-nested-frame")){const frame=document.createElement("iframe");frame.id="usshm-nested-frame";frame.srcdoc="<button id=iframe-only>Nested DOM</button>";document.body.append(frame);}\n';
const known=(button:string,pane:string)=>
 HEADER+'const actionButton=document.querySelector("'+button+'");const targetPane=document.querySelector("'+pane+'");\n'+TAIL;

export const SYNTHETIC_LIFECYCLE_SOURCES=Object.freeze({
 baseline:known('#old-heal-button','.old-target-pane'),
 partial:known('#heal-button','.old-target-pane'),
 repaired:known('#heal-button','.target-pane'),
 rollback:known('#old-heal-button','.old-target-pane'),
});
type Stage=keyof typeof SYNTHETIC_LIFECYCLE_SOURCES;
type Status='fixture-passed'|'fixture-failed'|'fixture-blocked';
const stages=['baseline','partial','repaired','rollback'] as const;
const expected:Record<Stage,boolean>={baseline:false,partial:false,repaired:true,rollback:false};
type Observations=Record<Stage,boolean|null>;

export interface SyntheticFunctionalReceipt{
 readonly caseId:'SYNTHETIC-TWO-SELECTOR-REPAIR-ROLLBACK';
 readonly status:Status;
 readonly failedStage:Stage|null;
 readonly reason:string;
 readonly observations:Observations;
 readonly validationLevel:'synthetic-fixture-functional';
 readonly productionEligible:false;
 readonly V3:'not-configured';
 readonly V4:'not-configured';
 readonly functionalVerified:false;
 readonly managerVerified:false;
}

/**
 * Assert four causally meaningful controls on a disposable fixture:
 * old selector fails, one patch still fails, both patches work, rollback
 * fails again. The invoker supplies a TEST-ONLY evaluator which independently
 * validates the exact source allowlist and Chrome frame identity.
 *
 * This reporter itself has no JavaScript evaluator / CDP writes / IPC.
 */
export async function runSyntheticFunctionalLifecycle(input:{
 readonly approved:boolean;
 readonly target:{id:string;type:string;url:string;webSocketDebuggerUrl?:string};
 readonly fixtureUrl:string;
 readonly sources:Record<Stage,string>;
 readonly execute:(source:string)=>Promise<boolean>;
}):Promise<SyntheticFunctionalReceipt>{
 const {approved,target,fixtureUrl,sources,execute}=input??{} as typeof input;
 if(approved!==true)throw new Error('Explicit synthetic fixture approval required');
 let url:URL;
 try{url=new URL(fixtureUrl);}catch{throw new Error('Invalid synthetic fixture URL');}
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
    url.pathname!=='/fixture'||url.search||url.hash||url.username||url.password||
    !target||target.type!=='page'||target.url!==fixtureUrl||
    typeof target.id!=='string'||!target.id||target.id.length>128)
  throw new Error('Refusing non-local or mismatched synthetic fixture target');
 // Synthetic fixture uses port 9223 only; no support for arbitrary CDP target.
 validateCdpPageSocket(target,9223);
 if(!sources||typeof sources!=='object'||Array.isArray(sources)||
    Object.keys(sources).length!==stages.length||
    stages.some(stage=>!Object.prototype.hasOwnProperty.call(sources,stage)||
      sources[stage]!==SYNTHETIC_LIFECYCLE_SOURCES[stage])||
    typeof execute!=='function')
  throw new Error('Refusing arbitrary or modified synthetic fixture source');

 const observations:Observations={baseline:null,partial:null,repaired:null,rollback:null};
 const build=(status:Status,failedStage:Stage|null,reason:string):SyntheticFunctionalReceipt=>({
  caseId:'SYNTHETIC-TWO-SELECTOR-REPAIR-ROLLBACK',
  status,failedStage,reason,observations:Object.freeze({...observations}),
  validationLevel:'synthetic-fixture-functional',
  productionEligible:false,V3:'not-configured',V4:'not-configured',
  functionalVerified:false,managerVerified:false,
 });
 for(const stage of stages){
  let result:unknown;
  try{result=await execute(SYNTHETIC_LIFECYCLE_SOURCES[stage]);}
  catch{
   // Do not leak untrusted page/script exception details or private paths.
   return build('fixture-blocked',stage,'Synthetic fixture execution unavailable');
  }
  if(typeof result!=='boolean')
   return build('fixture-blocked',stage,'Synthetic fixture returned invalid evidence');
  observations[stage]=result;
  if(result!==expected[stage])
   return build('fixture-failed',stage,'Synthetic '+stage+' control did not match expected behavior');
 }
 return build('fixture-passed',null,'All four named synthetic controls matched their expected outcomes');
}
