/**
 * Conservative verification projection for current static and read-only CDP
 * evidence. V0 and V1 are NOT proof of script behavior. Higher levels require
 * separately implemented safe interaction, named functional tests and real
 * userscript-manager attestations; this module deliberately cannot forge them.
 */
export type VerificationStatus='passed'|'failed'|'skipped'|'blocked'|'not-configured';
export type StaticScanStatus='parsed'|'parse-error'|'unreadable'|'skipped';
export interface DomVerificationEvidence {
 readonly status:string;
 readonly checked:number;
 readonly found:number;
 readonly missing:number;
 readonly needsReview:number;
}
export interface VerificationProjection {
 readonly V0:VerificationStatus;
 readonly V1:VerificationStatus;
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
 readonly highestVerified:'V0'|'V1'|null;
 readonly functionalVerified:false;
 readonly managerVerified:false;
}
/**
 * Non-escalation invariant: even a fully matched, real CDP DOM result may only
 * attest V1. It cannot show that a userscript was injected, executed or that
 * GM APIs and non-destructive business assertions passed.
 */
export function projectVerificationLevels({staticStatus,dom}:{
 readonly staticStatus:StaticScanStatus;
 readonly dom?:DomVerificationEvidence;
}):VerificationProjection{
 const V0:VerificationStatus=staticStatus==='parsed'?'passed':
  staticStatus==='parse-error'?'failed':
  staticStatus==='skipped'?'skipped':'blocked';
 let V1:VerificationStatus='blocked';
 if(V0==='passed'&&dom){
  const validCounts=[dom.checked,dom.found,dom.missing,dom.needsReview]
   .every(value=>Number.isSafeInteger(value)&&value>=0);
  if(validCounts&&dom.checked<=50&&dom.found+dom.missing+dom.needsReview===dom.checked){
   if(dom.status==='dom-present'&&dom.checked>0&&dom.found===dom.checked)
    V1='passed';
   else if(dom.status==='locator-missing'&&dom.missing>0&&dom.checked>0)
    V1='failed';
   else if(dom.status==='out-of-scope'||dom.status==='skipped')
    V1='skipped';
   else if(dom.status==='no-evidence')V1='not-configured';
  }
 }
 return {
  V0,V1,V2:'blocked',V3:'not-configured',V4:'not-configured',
  highestVerified:V1==='passed'?'V1':V0==='passed'?'V0':null,
  functionalVerified:false,managerVerified:false,
 };
}
