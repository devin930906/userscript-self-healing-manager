import {randomUUID} from 'node:crypto';
import type {AuditJournal} from '../../../../packages/audit-journal/src/index.ts';

export interface RetainedRepairApprovalFreshness{
 readonly checkedAt:number;
 readonly expiresAt:number;
}

export interface RetainedRepairAuditInput{
 readonly journal:AuditJournal;
 readonly jobId:string;
 readonly scriptId:string;
 readonly attemptId:string;
 readonly sourceSha256:string;
 readonly revisionSha256:string;
 readonly previousHash:string;
 readonly approval:RetainedRepairApprovalFreshness;
 readonly restore:(expectedCurrentHash:string)=>Promise<{hash:string;activePath:string}>;
 readonly newId?:()=>string;
}

function instant(value:number):string{
 if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid retained repair audit timestamp');
 const date=new Date(value);
 const iso=date.toISOString();
 if(Date.parse(iso)!==value)throw new Error('Invalid retained repair audit timestamp');
 return iso;
}

/**
 * Persist the complete FR-041 trace only after V1 retention has succeeded.
 *
 * Audit failure is never allowed to leave an unaudited managed revision active:
 * attempt a caller-owned compare-and-swap rollback to the exact predecessor.
 * No source text, selector, path, URL, page data or exception text is stored.
 */
export async function persistRetainedRepairAudit(
 input:RetainedRepairAuditInput,
):Promise<Readonly<{revisionId:string;jobId:string;revisionSha256:string}>>{
 const newId=input.newId??randomUUID;
 try{
  if(!input.journal||typeof input.journal.append!=='function'||typeof newId!=='function'||
     typeof input.restore!=='function')
   throw new Error('Invalid retained repair audit dependencies');
  const checkedAt=instant(input.approval?.checkedAt);
  const expiresAt=instant(input.approval?.expiresAt);
  if(input.approval.expiresAt<=input.approval.checkedAt)
   throw new Error('Invalid retained repair audit approval window');
  const findingId=newId(),candidateId=newId(),testId=newId(),approvalId=newId(),revisionId=newId();
  return input.journal.append({
   job:{id:input.jobId,scriptId:input.scriptId,attemptId:input.attemptId,sourceSha256:input.sourceSha256},
   finding:{id:findingId,jobId:input.jobId,scriptId:input.scriptId,attemptId:input.attemptId},
   candidate:{id:candidateId,findingId,jobId:input.jobId},
   test:{id:testId,candidateId,jobId:input.jobId,status:'passed'},
   approval:{id:approvalId,testId,candidateId,jobId:input.jobId,sourceSha256:input.sourceSha256,expiresAt},
   revision:{id:revisionId,approvalId,candidateId,jobId:input.jobId,scriptId:input.scriptId,
    sourceSha256:input.sourceSha256,revisionSha256:input.revisionSha256},
  },checkedAt);
 }catch{
  let restored=false;
  try{
   if(typeof input.restore==='function'){
    const receipt=await input.restore(input.revisionSha256);
    restored=receipt?.hash===input.previousHash&&
     typeof receipt.activePath==='string'&&receipt.activePath.length>0;
   }
  }catch{
   // A failed rollback remains an explicit manual-review state.
  }
  if(!restored)
   throw new Error('Retained managed repair audit failed; rollback blocked, manual review required');
  throw new Error('Retained managed repair audit failed; prior revision restored');
 }
}
