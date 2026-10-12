import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {parseMultiScriptBatchRequest} from '../src/main/multi-script-batch-request.ts';

const good=()=>{
 const a=randomUUID(),b=randomUUID();
 return {scanId:randomUUID(),approved:true,jobs:[
  {itemIndex:0,proposalId:a},{itemIndex:1,proposalId:b},
 ]};
};
test('FR-030 accepts only a fresh 2-to-8 script native approval request with pinned identity fields',()=>{
 const value=parseMultiScriptBatchRequest(good());
 assert.equal(value.approved,true);
 assert.equal(value.stopOnFailure,false);
 assert.deepEqual(value.jobs.map(x=>x.itemIndex),[0,1]);
 assert.equal(Object.isFrozen(value),true);
 assert.equal(Object.isFrozen(value.jobs),true);
 assert.equal(Object.isFrozen(value.jobs[0]),true);
 assert.equal(parseMultiScriptBatchRequest({...good(),stopOnFailure:true}).stopOnFailure,true);
});
test('FR-030 rejects duplicate item indexes, case-insensitive duplicate approval IDs and forged fields before Main prompts',()=>{
 const req=good();
 const proposals=req.jobs as {itemIndex:number;proposalId:string}[];
 const invalid=[
  {...req,jobs:[proposals[0],{...proposals[1],itemIndex:proposals[0]!.itemIndex}]},
  {...req,jobs:[proposals[0],{...proposals[1],proposalId:proposals[0]!.proposalId.toUpperCase()}]},
  {...req,rawCdpCommand:'Page.navigate'},
  {...req,jobs:[{...proposals[0],originalPath:'C:/private.user.js'},proposals[1]]},
  {...req,jobs:[proposals[0],proposals[0]]},
  {...req,scanId:'../../other'},
  {...req,approved:false},
  {...req,stopOnFailure:'false'},
  {...req,jobs:[proposals[0]]},
  {...req,jobs:Array.from({length:9},(_,i)=>({itemIndex:i,proposalId:randomUUID()}))},
 ];
 for(const value of invalid)
  assert.throws(()=>parseMultiScriptBatchRequest(value),/invalid|approval|script|budget|duplicate/i);
});
test('FR-030 mutation of renderer input cannot change the reviewed Main-owned request snapshot',()=>{
 const original=good();
 const request=parseMultiScriptBatchRequest(original);
 const first=request.jobs[0]!.proposalId;
 original.jobs[0]!.proposalId=randomUUID();
 original.jobs.push({itemIndex:9,proposalId:randomUUID()});
 assert.equal(request.jobs.length,2);
 assert.equal(request.jobs[0]!.proposalId,first);
 assert.throws(()=>{(request.jobs as unknown as unknown[]).push('injected');},TypeError);
});
