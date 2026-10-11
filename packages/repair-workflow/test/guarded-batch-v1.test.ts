import assert from 'node:assert/strict';
import {test} from 'node:test';
import {guardAppliedManagedBatchRevision} from '../src/guarded-batch-v1.ts';

const old='a'.repeat(64),applied='b'.repeat(64);
const good=(caseId:string)=>({
 caseId,status:'passed',evidenceLevel:'V1',expectation:'unique',attempts:2,matchCount:1,
 V2:'blocked',V3:'not-configured',V4:'not-configured',functionalVerified:false,managerVerified:false,
});
function setup(verdict:(index:number)=>Promise<unknown>){
 const verified:number[]=[];const restored:string[]=[];
 return {
  verified,restored,
  input:{
   approved:true,scriptId:'multi-safe',appliedHash:applied,previousHash:old,
   selectorIndexes:[1,3],
   verify:async(index:number)=>{verified.push(index);return verdict(index);},
   confirmActiveHash:async()=>applied,
   restore:async(hash:string)=>{restored.push(hash);return {hash,activePath:'/safe/current.user.js'};},
  },
 };
}
test('two uniquely passing, separately named, pinned V1 contracts retain exactly one batch revision',async()=>{
 const x=setup(async i=>good('BATCH:multi-safe:IDX_'+i));
 const result=await guardAppliedManagedBatchRevision(x.input);
 assert.deepEqual(x.verified,[1,3]);
 assert.deepEqual(x.restored,[]);
 assert.equal(result.status,'retained-v1');
 assert.equal(result.appliedHash,applied);
 assert.equal(result.activeHash,applied);
 assert.deepEqual(result.verifiedIndexes,[1,3]);
 assert.equal(result.V2,'blocked');
 assert.equal(result.V3,'not-configured');
 assert.equal(result.V4,'not-configured');
 assert.equal(result.functionalVerified,false);
 assert.equal(result.managerVerified,false);
});
test('if any of two or more batch selector checks fails, roll back ALL edits to exact immutable predecessor',async()=>{
 for(const invalid of [
  {...good('BATCH:multi-safe:IDX_3'),status:'failed'},
  {...good('BATCH:multi-safe:IDX_3'),status:'needs-review'},
  {...good('BATCH:multi-safe:IDX_3'),attempts:1},
  {...good('BATCH:multi-safe:IDX_3'),expectation:'exists'},
  {...good('BATCH:multi-safe:IDX_3'),matchCount:2},
  {...good('BATCH:multi-safe:IDX_3'),V2:'passed'},
  {...good('BATCH:multi-safe:IDX_3'),managerVerified:true},
  {...good('BATCH:multi-safe:IDX_3'),caseId:'BATCH:multi-safe:IDX_1'},
 ]){
  const x=setup(async i=>i===1?good('BATCH:multi-safe:IDX_1'):invalid);
  const result=await guardAppliedManagedBatchRevision(x.input);
  assert.equal(result.status,'rolled-back-v1');
  assert.equal(result.activeHash,old);
  assert.deepEqual(x.restored,[old]);
  assert.equal(result.functionalVerified,false);
 }
});
test('CDP transport failure and rollback CAS conflict fail closed without certifying any V2/V3/V4',async()=>{
 const x=setup(async i=>{if(i===3)throw new Error('private-CDP-secret');return good('BATCH:multi-safe:IDX_'+i);});
 x.input.restore=async()=>{throw new Error('other desktop process has changed active revision');};
 const result=await guardAppliedManagedBatchRevision(x.input);
 assert.equal(result.status,'rollback-blocked');
 assert.equal(result.activeHash,null);
 assert.equal(result.V2,'blocked');
 assert.equal(JSON.stringify(result).includes('private-CDP-secret'),false);
});
test('malformed approval, invalid indexes and hash do not reach CDP or disk rollback',async()=>{
 const scenarios=[
  {selectorIndexes:[1]},
  {selectorIndexes:[1,1]},
  {selectorIndexes:[2,49,50]},
  {selectorIndexes:[4,3]},
  {selectorIndexes:[...Array(9).keys()]},
  {scriptId:'../../escape'},
  {approved:false},
  {previousHash:applied},
  {appliedHash:'x'},
 ];
 for(const update of scenarios){
  const x=setup(async i=>good('BATCH:multi-safe:IDX_'+i));
  await assert.rejects(guardAppliedManagedBatchRevision({...x.input,...update} as any),
   /batch|approval|index|hash|invalid|unique|order|script/i);
  assert.deepEqual(x.verified,[]);
  assert.deepEqual(x.restored,[]);
 }
});

test('all passing batch DOM selectors are insufficient if another writer changed the active revision',async()=>{
 const x=setup(async i=>good('BATCH:multi-safe:IDX_'+i));
 let checks=0;
 x.input.confirmActiveHash=async()=>{checks++;return old;};
 x.input.restore=async()=>{throw Error('Concurrent active revision has changed');};
 const result=await guardAppliedManagedBatchRevision(x.input);
 assert.deepEqual(x.verified,[1,3]);
 assert.equal(checks,1);
 assert.equal(result.status,'rollback-blocked');
 assert.equal(result.activeHash,null);
 assert.deepEqual(result.verifiedIndexes,[1,3]);
 assert.equal(result.V4,'not-configured');
});

test('unavailable/contradictory active revision check restores full predecessor rather than retaining the batch',async()=>{
 for(const check of [async()=>null,async()=>{throw Error('private-filename');},async()=> 'x'.repeat(64)]){
  const x=setup(async i=>good('BATCH:multi-safe:IDX_'+i));
  x.input.confirmActiveHash=check;
  const result=await guardAppliedManagedBatchRevision(x.input);
  assert.equal(result.status,'rolled-back-v1');
  assert.deepEqual(x.restored,[old]);
  assert.ok(!JSON.stringify(result).includes('private-filename'));
 }
});

test('batch post-verify check is required but must not run for partial V1 failures',async()=>{
 const x=setup(async i=>i===1?good('BATCH:multi-safe:IDX_1'):{...good('BATCH:multi-safe:IDX_3'),status:'failed'});
 x.input.confirmActiveHash=async()=>{throw Error('post-check should only run after full pass');};
 assert.equal((await guardAppliedManagedBatchRevision(x.input)).status,'rolled-back-v1');
 const invalid=setup(async i=>good('BATCH:multi-safe:IDX_'+i));
 await assert.rejects(guardAppliedManagedBatchRevision({...invalid.input,confirmActiveHash:undefined} as any),/invalid|confirm|guard/i);
 assert.deepEqual(invalid.verified,[]);
 assert.deepEqual(invalid.restored,[]);
});
