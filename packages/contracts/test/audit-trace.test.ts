import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {parseAuditTrace} from '../src/audit-trace.ts';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const hash='a'.repeat(64);
const good=()=>({
 job:{id:id(1),scriptId:id(2),attemptId:id(3),sourceSha256:hash},
 finding:{id:id(4),jobId:id(1),scriptId:id(2),attemptId:id(3)},
 candidate:{id:id(5),findingId:id(4),jobId:id(1)},
 test:{id:id(6),candidateId:id(5),jobId:id(1),status:'passed'},
 approval:{id:id(7),testId:id(6),candidateId:id(5),jobId:id(1),sourceSha256:hash,expiresAt:'2026-10-12T00:00:00.000Z'},
 revision:{id:id(8),approvalId:id(7),candidateId:id(5),jobId:id(1),scriptId:id(2),sourceSha256:hash}
});
const now='2026-10-11T08:00:00.000Z';
describe('FR-041 immutable cross-entity trace contracts',()=>{
 it('accepts a complete pinned same-job chain',()=>{const result=parseAuditTrace(good(),now);assert.equal(result.revision.approvalId,id(7));assert.equal(Object.isFrozen(result.job),true);assert.equal(Object.isFrozen(result),true);});

 it('rejects symbol and non-enumerable own extras at every audit stage',()=>{
  for(const stage of [null,'job','finding','candidate','test','approval','revision'] as const){
   for(const kind of ['symbol','hidden'] as const){
    const input:any=good();const target=stage===null?input:input[stage];
    if(kind==='symbol')Object.defineProperty(target,Symbol('unexpected'),{value:'forged',enumerable:true});
    else Object.defineProperty(target,'hiddenExtra',{value:'forged',enumerable:false});
    assert.throws(()=>parseAuditTrace(input,now),TypeError,`${stage??'root'} / ${kind}`);
   }
  }
 });
 it('continues accepting null-prototype input and nested records',()=>{
  const input:any=Object.assign(Object.create(null),good());
  for(const stage of ['job','finding','candidate','test','approval','revision'] as const)
   input[stage]=Object.assign(Object.create(null),input[stage]);
  assert.equal(parseAuditTrace(input,now).test.status,'passed');
 });
 it('rejects missing stages and malformed or extra fields',()=>{
  for(const field of ['job','finding','candidate','test','approval','revision'] as const){const value:any=good();delete value[field];assert.throws(()=>parseAuditTrace(value,now),TypeError);}
  assert.throws(()=>parseAuditTrace({...good(),extra:1},now),TypeError);
  const value:any=good();value.test.extra='forged';assert.throws(()=>parseAuditTrace(value,now),TypeError);
 });
 it('rejects foreign job, finding, candidate, test or approval references',()=>{
  for(const [stage,key] of [['finding','jobId'],['candidate','findingId'],['candidate','jobId'],['test','candidateId'],['test','jobId'],['approval','testId'],['approval','candidateId'],['revision','approvalId'],['revision','candidateId'],['revision','jobId']] as const){
   const value:any=good();value[stage][key]=id(90);assert.throws(()=>parseAuditTrace(value,now),TypeError,`${stage}.${key}`);
  }
 });
 it('rejects cross-script, cross-attempt and stale source rebinding',()=>{
  for(const [stage,key,value] of [['finding','scriptId',id(90)],['finding','attemptId',id(90)],['revision','scriptId',id(90)],['approval','sourceSha256','b'.repeat(64)],['revision','sourceSha256','b'.repeat(64)]] as const){
   const input:any=good();input[stage][key]=value;assert.throws(()=>parseAuditTrace(input,now),TypeError);
  }
 });
 it('rejects expired approval and nonpassing test without claiming signatures',()=>{
  assert.throws(()=>parseAuditTrace(good(),'2026-10-12T00:00:00.000Z'),TypeError);
  const failed:any=good();failed.test.status='failed';assert.throws(()=>parseAuditTrace(failed,now),TypeError);
 });
 it('rejects invalid IDs, impossible timestamps and inherited objects',()=>{
  const bad:any=good();bad.job.id=' ../foo ';assert.throws(()=>parseAuditTrace(bad,now),TypeError);
  assert.throws(()=>parseAuditTrace(good(),'not-a-date'),TypeError);
  const proto=Object.assign(Object.create({revision:good().revision}),good());assert.throws(()=>parseAuditTrace(proto,now),TypeError);
 });
});
