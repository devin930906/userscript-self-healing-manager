import assert from 'node:assert/strict';
import {test} from 'node:test';
import {guardAppliedManagedRevision} from '../src/guarded-v1.ts';

const original='a'.repeat(64),applied='b'.repeat(64);
function fixture(outcome:unknown|Error){
 let verified=0,rollbacks:string[]=[];
 const input={
  approved:true,scriptId:'fixture-script',appliedHash:applied,previousHash:original,
  verify:async()=>{verified++;if(outcome instanceof Error)throw outcome;return outcome;},
  restore:async(hash:string)=>{rollbacks.push(hash);return {hash,activePath:'C:/Data/managed/fixture-script/current.user.js'};},
 };
 return {input,stats:()=>({verified,rollbacks})};
}
const passed={status:'passed',evidenceLevel:'V1',attempts:2,matchCount:1,
 V2:'blocked',V3:'not-configured',V4:'not-configured',
 functionalVerified:false,managerVerified:false};

test('only two-sample genuine V1 success may retain the approved managed patch',async()=>{
 const f=fixture(passed);
 const result=await guardAppliedManagedRevision(f.input);
 assert.deepEqual(result,{status:'retained-v1',appliedHash:applied,activeHash:applied,
  V2:'blocked',V3:'not-configured',V4:'not-configured',functionalVerified:false,managerVerified:false});
 assert.deepEqual(f.stats(),{verified:1,rollbacks:[]});
});

test('an explicit two-sample V1 failed or needs-review triggers exact archived revision rollback',async()=>{
 for(const status of ['failed','needs-review'] as const){
  const f=fixture({...passed,status});
  const result=await guardAppliedManagedRevision(f.input);
  assert.equal(result.status,'rolled-back-v1');
  assert.equal(result.activeHash,original);
  assert.equal(result.appliedHash,applied);
  assert.equal(result.functionalVerified,false);
  assert.deepEqual(f.stats().rollbacks,[original]);
 }
});

test('CDP transport failure, missing fingerprint and contradictory evidence are never treated as success',async()=>{
 for(const bad of [
  new Error('Chrome disconnected'),
  {...passed,attempts:1},
  {...passed,evidenceLevel:'V3'},
  {...passed,managerVerified:true},
  {...passed,V2:'passed'},
  {...passed,status:'passed',matchCount:0},
 ]){
  const f=fixture(bad);
  const result=await guardAppliedManagedRevision(f.input);
  assert.equal(result.status,'rolled-back-v1');
  assert.deepEqual(f.stats().rollbacks,[original]);
 }
});

test('if rollback cannot be safely committed, report blocked and never claim retained or successfully reverted',async()=>{
 const f=fixture({...passed,status:'needs-review'});
 f.input.restore=async()=>{throw Error('External edits detected; refusing rollback');};
 const result=await guardAppliedManagedRevision(f.input);
 assert.equal(result.status,'rollback-blocked');
 assert.equal(result.activeHash,null);
 assert.equal(result.functionalVerified,false);
});

test('no approval, forged hash, same before/after revision and malicious script ID fail before touching disk or CDP',async()=>{
 for(const mutate of [
  (x:any)=>{x.approved=false;},
  (x:any)=>{x.scriptId='../other';},
  (x:any)=>{x.previousHash='not-a-hash';},
  (x:any)=>{x.appliedHash=x.previousHash;},
  (x:any)=>{x.restore=null;},
 ]){
  const f=fixture(passed);mutate(f.input);
  await assert.rejects(guardAppliedManagedRevision(f.input),/approval|invalid|script|hash|guard/i);
  assert.deepEqual(f.stats(),{verified:0,rollbacks:[]});
 }
});
