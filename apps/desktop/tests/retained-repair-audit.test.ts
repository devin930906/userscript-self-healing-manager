import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it} from 'node:test';
import {openAuditJournal} from '../../../packages/audit-journal/src/index.ts';
import {persistRetainedRepairAudit} from '../src/main/retained-repair-audit.ts';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sourceHash='a'.repeat(64);
const revisionHash='b'.repeat(64);
const previousHash='c'.repeat(64);
const checkedAt=Date.parse('2026-10-11T08:00:00.000Z');
const expiresAt=Date.parse('2026-10-11T08:10:00.000Z');

describe('FR-041 retained managed repair audit bridge',()=>{
 it('persists a retained V1 repair as a queryable durable audit chain',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-retained-audit-'));
  try{
   const journal=openAuditJournal(join(root,'audit.sqlite'));
   const ids=[id(4),id(5),id(6),id(7),id(8)];
   let restored=false;
   const receipt=await persistRetainedRepairAudit({
    journal,jobId:id(1),scriptId:id(2),attemptId:id(3),
    sourceSha256:sourceHash,revisionSha256:revisionHash,previousHash,
    approval:{checkedAt,expiresAt},
    newId:()=>ids.shift()!,
    restore:async()=>{restored=true;return {hash:previousHash,activePath:'managed/current.user.js'};},
   });
   assert.equal(restored,false);
   assert.equal(receipt.revisionId,id(8));
   const trace=journal.getByRevision(id(8));
   assert.ok(trace);
   assert.equal(trace.job.id,id(1));
   assert.equal(trace.job.scriptId,id(2));
   assert.equal(trace.job.attemptId,id(3));
   assert.equal(trace.revision.revisionSha256,revisionHash);
   assert.equal(trace.approval.expiresAt,'2026-10-11T08:10:00.000Z');
   journal.close();
  }finally{await rm(root,{recursive:true,force:true});}
 });

 it('restores the exact predecessor when durable audit persistence fails',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-retained-audit-'));
  try{
   const journal=openAuditJournal(join(root,'audit.sqlite'));
   let expectedCurrent:string|undefined;
   await assert.rejects(()=>persistRetainedRepairAudit({
    journal,jobId:'not-a-uuid',scriptId:id(2),attemptId:id(3),
    sourceSha256:sourceHash,revisionSha256:revisionHash,previousHash,
    approval:{checkedAt,expiresAt},
    restore:async(current)=>{expectedCurrent=current;return {hash:previousHash,activePath:'managed/current.user.js'};},
   }),/audit failed.*prior revision restored/i);
   assert.equal(expectedCurrent,revisionHash);
   journal.close();
  }finally{await rm(root,{recursive:true,force:true});}
 });

 it('surfaces manual review when audit persistence fails and rollback cannot be certified',async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-retained-audit-'));
  try{
   const journal=openAuditJournal(join(root,'audit.sqlite'));
   await assert.rejects(()=>persistRetainedRepairAudit({
    journal,jobId:'not-a-uuid',scriptId:id(2),attemptId:id(3),
    sourceSha256:sourceHash,revisionSha256:revisionHash,previousHash,
    approval:{checkedAt,expiresAt},
    restore:async()=>({hash:'d'.repeat(64),activePath:'managed/current.user.js'}),
   }),/audit failed.*rollback blocked.*manual review/i);
   journal.close();
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
