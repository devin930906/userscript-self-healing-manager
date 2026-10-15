import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
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

 it('rejects a forged no-op trigger that only reuses the expected append-only trigger name',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-audit-'));
  try{
   const file=join(root,'audit.sqlite');
   const journal=openAuditJournal(file);
   journal.append(trace(),now);
   journal.close();
   const raw=new DatabaseSync(file);
   try{
    raw.exec(`
DROP TRIGGER audit_jobs_no_update;
CREATE TRIGGER audit_jobs_no_update BEFORE UPDATE ON audit_jobs BEGIN SELECT 1; END;
`);
   }finally{raw.close();}
   let accepted:ReturnType<typeof openAuditJournal>|undefined;
   let issue:unknown;
   try{accepted=openAuditJournal(file);}catch(error){issue=error;}
   accepted?.close();
   assert.ok(issue instanceof Error,'a trigger name alone must not certify append-only history');
   assert.match(issue.message,/trigger|append-only|schema|incompatible/i);
  }finally{await rm(root,{recursive:true,force:true});}
 });


 it('refuses to reconstruct a trace when historical job bytes no longer match its revision chain',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-audit-'));
  try{
   const file=join(root,'audit.sqlite');
   let journal=openAuditJournal(file);
   journal.append(trace(),now);
   journal.close();
   const raw=new DatabaseSync(file);
   try{
    raw.exec('DROP TRIGGER audit_jobs_no_update');
    raw.prepare('UPDATE audit_jobs SET source_sha256=? WHERE id=?').run('c'.repeat(64),id(1));
    raw.exec("CREATE TRIGGER audit_jobs_no_update BEFORE UPDATE ON audit_jobs BEGIN SELECT RAISE(ABORT,'audit journal is append-only'); END;");
   }finally{raw.close();}
   journal=openAuditJournal(file);
   let issue:unknown;
   try{journal.getByRevision(id(8));}catch(error){issue=error;}
   journal.close();
   assert.ok(issue instanceof Error,'retrieval must verify the actual stored entities, not reconstruct them from revision aliases');
   assert.match(issue.message,/corrupt|mismatch|audit|immutable|source/i);
  }finally{await rm(root,{recursive:true,force:true});}
 });

 it('rejects non-UUID persisted script and attempt identities even when all linked rows agree',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-audit-'));
  try{
   const file=join(root,'audit.sqlite');
   let journal=openAuditJournal(file);
   journal.append(trace(),now);
   journal.close();
   const raw=new DatabaseSync(file);
   try{
    for(const table of ['audit_jobs','audit_findings','audit_revisions'])
     raw.exec(`DROP TRIGGER ${table}_no_update`);
    raw.prepare('UPDATE audit_jobs SET script_id=?,attempt_id=? WHERE id=?').run('not-a-uuid','also-not-a-uuid',id(1));
    raw.prepare('UPDATE audit_findings SET script_id=?,attempt_id=? WHERE id=?').run('not-a-uuid','also-not-a-uuid',id(4));
    raw.prepare('UPDATE audit_revisions SET script_id=? WHERE id=?').run('not-a-uuid',id(8));
    for(const table of ['audit_jobs','audit_findings','audit_revisions'])
     raw.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'audit journal is append-only'); END;`);
   }finally{raw.close();}
   journal=openAuditJournal(file);
   let issue:unknown;
   try{journal.getByRevision(id(8));}catch(error){issue=error;}
   journal.close();
   assert.ok(issue instanceof Error,'retrieval must validate persisted script and attempt identities, not only stage entity IDs');
   assert.match(issue.message,/corrupt|identity|uuid|audit/i);
  }finally{await rm(root,{recursive:true,force:true});}
 });

 it('rejects malformed persisted approval expiry without treating historical expiry as authorization',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-audit-'));
  try{
   const file=join(root,'audit.sqlite');
   let journal=openAuditJournal(file);
   journal.append(trace(),now);
   journal.close();
   const raw=new DatabaseSync(file);
   try{
    raw.exec('DROP TRIGGER audit_approvals_no_update');
    raw.prepare('UPDATE audit_approvals SET expires_at=? WHERE id=?').run('not-a-time',id(7));
    raw.exec("CREATE TRIGGER audit_approvals_no_update BEFORE UPDATE ON audit_approvals BEGIN SELECT RAISE(ABORT,'audit journal is append-only'); END;");
   }finally{raw.close();}
   journal=openAuditJournal(file);
   let issue:unknown;
   try{journal.getByRevision(id(8));}catch(error){issue=error;}
   journal.close();
   assert.ok(issue instanceof Error,'historical retrieval must reject malformed persisted approval timestamps');
   assert.match(issue.message,/corrupt|approval|expiry|timestamp|audit/i);
  }finally{await rm(root,{recursive:true,force:true});}
 });

 it('rejects a later trace whose entity ID aliases a different historical audit stage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-audit-'));
  try{
   const journal=openAuditJournal(join(root,'audit.sqlite'));
   journal.append(trace(),now);
   const second:any=trace();
   second.job={id:id(11),scriptId:id(12),attemptId:id(13),sourceSha256:'c'.repeat(64)};
   second.finding={id:id(1),jobId:id(11),scriptId:id(12),attemptId:id(13)};
   second.candidate={id:id(15),findingId:id(1),jobId:id(11)};
   second.test={id:id(16),candidateId:id(15),jobId:id(11),status:'passed'};
   second.approval={id:id(17),testId:id(16),candidateId:id(15),jobId:id(11),sourceSha256:'c'.repeat(64),expiresAt:'2026-10-12T00:00:00.000Z'};
   second.revision={id:id(18),approvalId:id(17),candidateId:id(15),jobId:id(11),scriptId:id(12),sourceSha256:'c'.repeat(64),revisionSha256:'d'.repeat(64)};
   assert.throws(()=>journal.append(second,now),/duplicate|entity|identity|stage|unique/i,
    'one UUID must not identify a job in one trace and a finding in another');
   assert.equal(journal.getByRevision(id(18)),null);
   journal.close();
  }finally{await rm(root,{recursive:true,force:true});}
 });

 it('rejects a persisted chain whose stage identities alias after storage tampering',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-audit-'));
  try{
   const file=join(root,'audit.sqlite');
   let journal=openAuditJournal(file);
   journal.append(trace(),now);
   journal.close();
   const raw=new DatabaseSync(file);
   try{
    raw.exec('PRAGMA foreign_keys=OFF');
    for(const table of ['audit_candidates','audit_tests','audit_approvals','audit_revisions'])
     raw.exec(`DROP TRIGGER ${table}_no_update`);
    raw.prepare('UPDATE audit_candidates SET id=? WHERE id=?').run(id(1),id(5));
    raw.prepare('UPDATE audit_tests SET candidate_id=? WHERE id=?').run(id(1),id(6));
    raw.prepare('UPDATE audit_approvals SET candidate_id=? WHERE id=?').run(id(1),id(7));
    raw.prepare('UPDATE audit_revisions SET candidate_id=? WHERE id=?').run(id(1),id(8));
    for(const table of ['audit_candidates','audit_tests','audit_approvals','audit_revisions'])
     raw.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'audit journal is append-only'); END;`);
   }finally{raw.close();}
   journal=openAuditJournal(file);
   let issue:unknown;
   try{journal.getByRevision(id(8));}catch(error){issue=error;}
   journal.close();
   assert.ok(issue instanceof Error,'retrieval must reject one UUID aliasing multiple persisted audit stages');
   assert.match(issue.message,/corrupt|duplicate|distinct|identity|audit/i);
  }finally{await rm(root,{recursive:true,force:true});}
 });

});
