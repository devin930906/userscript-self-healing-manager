import assert from 'node:assert/strict';
import {test} from 'node:test';
import {guardAppliedManagedRevision} from '../src/guarded-v1.ts';

const applied='a'.repeat(64),previous='b'.repeat(64);
const expectedCaseId='MANAGED_GUARD_script-one:IDX_3';
const passed={
 caseId:expectedCaseId,status:'passed',evidenceLevel:'V1',
 expectation:'unique',attempts:2,matchCount:1,
 V2:'blocked',V3:'not-configured',V4:'not-configured',
 functionalVerified:false,managerVerified:false,
};
function fixture(proof:unknown,expected=expectedCaseId){
 let inspections=0,rollbacks=0,activeChecks=0;
 const input={
  approved:true,scriptId:'script-one',appliedHash:applied,previousHash:previous,
  expectedCaseId:expected,
  verify:async()=>{inspections++;return proof;},
  confirmActiveHash:async()=>{activeChecks++;return applied;},
  restore:async(hash:string)=>{
   rollbacks++;
   return {hash,activePath:'C:/synthetic-managed/current.user.js'};
  },
 };
 return {input,counters:()=>({inspections,rollbacks,activeChecks})};
}

test('FR-024 V1 guard retains only a result for the exact reviewed script and selector case',async()=>{
 const right=fixture(passed);
 const kept=await guardAppliedManagedRevision(right.input);
 assert.equal(kept.status,'retained-v1');
 assert.deepEqual(right.counters(),{inspections:1,rollbacks:0,activeChecks:1});

 for(const spoofed of [
  {...passed,caseId:'MANAGED_GUARD_script-one:IDX_4'},
  {...passed,caseId:'MANAGED_GUARD_other-script:IDX_3'},
  {...passed,caseId:'MANAGED_GUARD_script-one:IDX_3\nprivate'},
  {...passed,caseId:undefined},
  {...passed,caseId:null},
 ]){
  const attempted=fixture(spoofed);
  const result=await guardAppliedManagedRevision(attempted.input);
  assert.equal(result.status,'rolled-back-v1',
   'a success for another case must never retain a revision');
  assert.equal(result.activeHash,previous);
  assert.deepEqual(attempted.counters(),{inspections:1,rollbacks:1,activeChecks:0});
 }
});

test('FR-024 missing or unrelated expected case identity blocks before any browser or disk work',async()=>{
 for(const invalid of ['MANAGED_GUARD_script-two:IDX_3',
  'MANAGED_GUARD_script-one:IDX_50',
  'MANAGED_GUARD_script-one:IDX_3\nPRIVATE',
  '',
 ]){
  const f=fixture(passed,invalid);
  await assert.rejects(guardAppliedManagedRevision(f.input),
   /case|identity|guard|invalid|selector/i);
  assert.deepEqual(f.counters(),{inspections:0,rollbacks:0,activeChecks:0});
 }
 const missing=fixture(passed);
 const missingCaseId={...missing.input};
 delete (missingCaseId as {expectedCaseId?:string}).expectedCaseId;
 await assert.rejects(guardAppliedManagedRevision(missingCaseId as any),
  /case|identity|guard|invalid|selector/i);
 assert.deepEqual(missing.counters(),{inspections:0,rollbacks:0,activeChecks:0});
});


test('FR-024 colliding 24-character script prefixes cannot share V1 retention evidence',async()=>{
 const common='script-with-identical-prefix-';
 const first=common+'first',second=common+'second';
 assert.equal(first.slice(0,24),second.slice(0,24));
 const exactCaseId='MANAGED_GUARD_'+first+':IDX_7';
 const incorrectCaseId='MANAGED_GUARD_'+second+':IDX_7';
 let rollbacks=0,activeChecks=0;
 const input={
  approved:true,scriptId:first,appliedHash:applied,previousHash:previous,
  expectedCaseId:exactCaseId,
  verify:async()=>({...passed,caseId:incorrectCaseId}),
  confirmActiveHash:async()=>{activeChecks++;return applied;},
  restore:async(hash:string)=>{rollbacks++;return {hash,activePath:'C:/synthetic/current.user.js'};},
 };
 const result=await guardAppliedManagedRevision(input);
 assert.equal(result.status,'rolled-back-v1');
 assert.equal(result.activeHash,previous);
 assert.equal(rollbacks,1);
 assert.equal(activeChecks,0);
 const correct=await guardAppliedManagedRevision({
  ...input,verify:async()=>({...passed,caseId:exactCaseId}),
 });
 assert.equal(correct.status,'retained-v1');
 assert.equal(activeChecks,1);
});
