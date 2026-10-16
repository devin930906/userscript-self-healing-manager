import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {openAuditJournal} from '../src/index.ts';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const source='a'.repeat(64);
const revision='b'.repeat(64);
const now='2026-10-15T09:30:00.000Z';

function trace(offset=0,scriptId=id(2),revisionSha256=revision){
 return {
  job:{id:id(1+offset),scriptId,attemptId:id(3+offset),sourceSha256:source},
  finding:{id:id(4+offset),jobId:id(1+offset),scriptId,attemptId:id(3+offset)},
  candidate:{id:id(5+offset),findingId:id(4+offset),jobId:id(1+offset)},
  test:{id:id(6+offset),candidateId:id(5+offset),jobId:id(1+offset),status:'passed' as const},
  approval:{id:id(7+offset),testId:id(6+offset),candidateId:id(5+offset),jobId:id(1+offset),
   sourceSha256:source,expiresAt:'2026-10-15T10:30:00.000Z'},
  revision:{id:id(8+offset),approvalId:id(7+offset),candidateId:id(5+offset),jobId:id(1+offset),
   scriptId,sourceSha256:source,revisionSha256},
 };
}

test('FR-041 audit journal resolves one durable trace by managed revision SHA and script identity after restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-audit-history-'));
 try{
  const file=join(root,'audit.sqlite');
  let journal=openAuditJournal(file);
  journal.append(trace(),now);
  journal.close();
  journal=openAuditJournal(file);
  const api=journal as typeof journal&{getByManagedRevision?:(input:{scriptId:string;revisionSha256:string})=>unknown};
  assert.equal(typeof api.getByManagedRevision,'function','durable history lookup is missing');
  const restored=api.getByManagedRevision!({scriptId:id(2),revisionSha256:revision}) as ReturnType<typeof journal.getByRevision>;
  assert.ok(restored);
  assert.equal(restored.revision.id,id(8));
  assert.equal(restored.revision.revisionSha256,revision);
  assert.equal(restored.revision.scriptId,id(2));
  assert.equal(api.getByManagedRevision!({scriptId:id(12),revisionSha256:revision}),null,
   'same hash must not cross script identity');
  journal.close();
 }finally{await rm(root,{recursive:true,force:true});}
});

test('FR-041 managed revision lookup fails closed when one script/hash maps to more than one audit revision',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-audit-history-'));
 try{
  const journal=openAuditJournal(join(root,'audit.sqlite'));
  journal.append(trace(),now);
  journal.append(trace(10,id(2),revision),'2026-10-15T09:31:00.000Z');
  const api=journal as typeof journal&{getByManagedRevision?:(input:{scriptId:string;revisionSha256:string})=>unknown};
  assert.equal(typeof api.getByManagedRevision,'function','durable history lookup is missing');
  assert.throws(()=>api.getByManagedRevision!({scriptId:id(2),revisionSha256:revision}),
   /ambiguous|multiple|duplicate/i);
  journal.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
