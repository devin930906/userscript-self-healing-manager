import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it} from 'node:test';
import {openAuditJournal} from '../src/index.ts';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sourceHash='a'.repeat(64);
const revisionHash='b'.repeat(64);
const now='2026-10-11T08:00:00.000Z';
const trace=()=>({
 job:{id:id(1),scriptId:id(2),attemptId:id(3),sourceSha256:sourceHash},
 finding:{id:id(4),jobId:id(1),scriptId:id(2),attemptId:id(3)},
 candidate:{id:id(5),findingId:id(4),jobId:id(1)},
 test:{id:id(6),candidateId:id(5),jobId:id(1),status:'passed'},
 approval:{id:id(7),testId:id(6),candidateId:id(5),jobId:id(1),sourceSha256:sourceHash,expiresAt:'2026-10-12T00:00:00.000Z'},
 revision:{id:id(8),approvalId:id(7),candidateId:id(5),jobId:id(1),scriptId:id(2),sourceSha256:sourceHash,revisionSha256:revisionHash},
});

describe('FR-041 durable append-only audit journal',()=>{
 it('persists one validated job→finding→candidate→test→approval→revision chain across restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-audit-'));
  try{
   const file=join(root,'audit.sqlite');
   let journal=openAuditJournal(file);
   const receipt=journal.append(trace(),now);
   assert.deepEqual(receipt,{revisionId:id(8),jobId:id(1),revisionSha256:revisionHash});
   journal.close();

   journal=openAuditJournal(file);
   const restored=journal.getByRevision(id(8));
   assert.ok(restored);
   assert.equal(restored.job.id,id(1));
   assert.equal(restored.finding.id,id(4));
   assert.equal(restored.candidate.id,id(5));
   assert.equal(restored.test.id,id(6));
   assert.equal(restored.approval.id,id(7));
   assert.equal(restored.revision.id,id(8));
   assert.equal(restored.revision.revisionSha256,revisionHash);
   assert.equal(Object.isFrozen(restored),true);
   journal.close();
  }finally{await rm(root,{recursive:true,force:true});}
 });

 it('rejects replayed or cross-chain entity IDs instead of rewriting historical audit evidence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-audit-'));
  try{
   const journal=openAuditJournal(join(root,'audit.sqlite'));
   journal.append(trace(),now);
   assert.throws(()=>journal.append(trace(),now),/duplicate|existing|immutable|unique/i);

   const forged:any=trace();
   forged.job.id=id(11);forged.finding.jobId=id(11);forged.candidate.jobId=id(11);
   forged.test.jobId=id(11);forged.approval.jobId=id(11);forged.revision.jobId=id(11);
   forged.revision.id=id(18);
   forged.revision.revisionSha256='c'.repeat(64);
   // Deliberately reuses the prior finding/candidate/test/approval identities.
   assert.throws(()=>journal.append(forged,now),/duplicate|existing|immutable|unique/i);
   assert.equal(journal.getByRevision(id(8))?.revision.revisionSha256,revisionHash);
   assert.equal(journal.getByRevision(id(18)),null);
   journal.close();
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
