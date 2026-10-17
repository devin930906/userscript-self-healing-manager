/**
 * TEST-ONLY: classify the three bounded, synthetic DOM receipt markers.
 * These categories aid RG-05 failure triage; only exact receipts count as success.
 * No URL, DOM text, extension ID or profile path is included in the output.
 */
export type SyntheticExtensionProbeStatus=
 'verified'|'untrusted-probe'|'content-script-not-observed'|
 'runtime-onmessage-not-observed'|'runtime-roundtrip-not-observed';

export function classifySyntheticExtensionProbe(
 probe:unknown,targetId:string,fixtureUrl:string,
):SyntheticExtensionProbeStatus{
 if(!probe||typeof probe!=='object')return 'untrusted-probe';
 const result=probe as {validationLevel?:unknown,targetId?:unknown,url?:unknown,checks?:unknown};
 if(result.validationLevel!=='dom-only'||result.targetId!==targetId||
    result.url!==fixtureUrl||!Array.isArray(result.checks)||result.checks.length!==3)
  return 'untrusted-probe';
 const failures:SyntheticExtensionProbeStatus[]=[
  'content-script-not-observed','runtime-onmessage-not-observed','runtime-roundtrip-not-observed',
 ];
 for(let i=0;i<3;i++){
  const check=result.checks[i];
  if(!check||typeof check!=='object')return 'untrusted-probe';
  if(check.status!=='found'||check.matchCount!==1)return failures[i];
 }
 return 'verified';
}
