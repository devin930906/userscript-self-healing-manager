import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ProposalApprovalGate} from '../src/proposal-approval.ts';

test('user-reviewed single and batch previews expire after a bounded window, not indefinitely',()=>{
 let current=10_000;
 const gate=new ProposalApprovalGate({now:()=>current,ttlMs:600_000});
 gate.register('batch-preview','scan-A');
 current+=599_999;
 assert.doesNotThrow(()=>gate.require('batch-preview','scan-A'));
 current+=2;
 assert.throws(()=>gate.require('batch-preview','scan-A'),/expired|stale|approval/i);
 current-=100;
 assert.throws(()=>gate.require('batch-preview','scan-A'),/stale|approval/i,
  'once expired, clock rollback cannot resurrect approved preview');
});
test('clock rewind and invalid clock values block a previously granted approval',()=>{
 let time=500_000;
 const gate=new ProposalApprovalGate({now:()=>time,ttlMs:600_000});
 gate.register('repair','scan');
 time-=2;
 assert.throws(()=>gate.require('repair','scan'),/expired|clock|stale|approval/i);
});
test('expired pending approvals are pruned before the 100-proposal limit',()=>{
 let time=1000;
 const gate=new ProposalApprovalGate({now:()=>time,ttlMs:600_000});
 for(let i=0;i<100;i++)gate.register('expired-'+i,'old-scan');
 time+=600_001;
 assert.doesNotThrow(()=>gate.register('new-approved','new-scan'));
 assert.throws(()=>gate.require('expired-0','old-scan'),/stale|expired|approval/i);
 assert.doesNotThrow(()=>gate.require('new-approved','new-scan'));
});
test('cannot configure zero, overlong or invalid approval TTL and cannot bypass exact scan identity',()=>{
 for(const ms of [0,-1,60_000.1,Infinity,24*60*60*1000]){
  assert.throws(()=>new ProposalApprovalGate({ttlMs:ms}),/ttl|invalid|approval|budget/i);
 }
 let now=100;
 const gate=new ProposalApprovalGate({now:()=>now,ttlMs:60_000});
 gate.register('proposal','scan-a');
 assert.throws(()=>gate.require('proposal','scan-b'),/stale|approval/i);
 now+=61_000;
 assert.throws(()=>gate.require('proposal','scan-a'),/expired|stale|approval/i);
});
