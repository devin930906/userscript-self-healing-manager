/**
 * Guard for one already-approved managed batch revision. Each changed selector
 * must pass an independently named, two-sample, unique-node read-only V1
 * contract. Any inconsistency restores the ENTIRE predecessor by the trusted
 * caller's compare-and-swap rollback; never a partial per-selector rollback.
 *
 * No Input events, userscript evaluation, Tampermonkey installation or
 * functional/V2/V3/V4 certification is performed by this module.
 */
export interface GuardedBatchV1Result{
 readonly status:'retained-v1'|'rolled-back-v1'|'rollback-blocked';
 readonly appliedHash:string;
 readonly activeHash:string|null;
 readonly verifiedIndexes:readonly number[];
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
 readonly functionalVerified:false;
 readonly managerVerified:false;
}
export async function guardAppliedManagedBatchRevision({
 approved,scriptId,appliedHash,previousHash,selectorIndexes,verify,restore,
}:{
 readonly approved:boolean;readonly scriptId:string;
 readonly appliedHash:string;readonly previousHash:string;
 readonly selectorIndexes:readonly number[];
 readonly verify:(selectorIndex:number)=>Promise<unknown>;
 readonly restore:(previousHash:string)=>Promise<{hash:string;activePath:string}>;
}):Promise<GuardedBatchV1Result>{
 if(approved!==true||typeof scriptId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(scriptId)||
    typeof appliedHash!=='string'||!/^[a-f0-9]{64}$/.test(appliedHash)||
    typeof previousHash!=='string'||!/^[a-f0-9]{64}$/.test(previousHash)||
    previousHash===appliedHash||typeof verify!=='function'||typeof restore!=='function'||
    !Array.isArray(selectorIndexes)||selectorIndexes.length<2||selectorIndexes.length>8||
    selectorIndexes.some((index,i)=>!Number.isSafeInteger(index)||index<0||index>=50||
      (i>0&&index<=selectorIndexes[i-1]!)))
  throw new Error('Invalid approved batch V1 guard, revision hashes or selector index order');
 const checked:number[]=[];
 const base={appliedHash,V2:'blocked' as const,V3:'not-configured' as const,
  V4:'not-configured' as const,functionalVerified:false as const,
  managerVerified:false as const};
 try{
  for(const index of selectorIndexes){
   const expectedCaseId='BATCH:'+scriptId+':IDX_'+index;
   const proof=await verify(index) as Record<string,unknown>|null;
   if(!proof||proof.caseId!==expectedCaseId||proof.status!=='passed'||
      proof.evidenceLevel!=='V1'||proof.expectation!=='unique'||
      proof.attempts!==2||proof.matchCount!==1||
      proof.V2!=='blocked'||proof.V3!=='not-configured'||proof.V4!=='not-configured'||
      proof.functionalVerified!==false||proof.managerVerified!==false)
    break;
   checked.push(index);
  }
  if(checked.length===selectorIndexes.length)
   return {...base,status:'retained-v1',activeHash:appliedHash,
    verifiedIndexes:Object.freeze([...checked])};
 }catch{
  // Chrome connection loss, changed document, invalidated scan or any
  // arbitrary page exception cannot retain an unverified batch.
 }
 try{
  const reverted=await restore(previousHash);
  if(reverted?.hash!==previousHash||typeof reverted?.activePath!=='string'||
     !reverted.activePath)
   return {...base,status:'rollback-blocked',activeHash:null,
    verifiedIndexes:Object.freeze([...checked])};
  return {...base,status:'rolled-back-v1',activeHash:previousHash,
   verifiedIndexes:Object.freeze([...checked])};
 }catch{
  // Another desktop/process may have activated a different revision.
  // Such a CAS conflict is neither a completed rollback nor retention.
  return {...base,status:'rollback-blocked',activeHash:null,
   verifiedIndexes:Object.freeze([...checked])};
 }
}
