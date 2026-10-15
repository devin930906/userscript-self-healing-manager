import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ProposalApprovalGate} from '../src/proposal-approval.ts';

test('a repair preview is approved only in the scan that generated it',()=>{
 const gate=new ProposalApprovalGate();
 gate.register('proposal-one','scan-A');
 assert.doesNotThrow(()=>gate.require('proposal-one','scan-A'));
 assert.throws(()=>gate.require('proposal-one','scan-B'),/stale|scan|approved/i);
 assert.throws(()=>gate.require('missing','scan-A'),/stale|scan|approved/i);
});
test('a rescan invalidates pending repair preview approval',()=>{
 const gate=new ProposalApprovalGate();
 gate.register('proposal-old','scan-A');
 gate.clear();
 assert.throws(()=>gate.require('proposal-old','scan-A'),/stale|scan|approved/i);
});
test('a saved repair cannot be approved a second time from a reused receipt',()=>{
 const gate=new ProposalApprovalGate();
 gate.register('proposal-one','scan-A');
 gate.require('proposal-one','scan-A');
 gate.consume('proposal-one');
 assert.throws(()=>gate.require('proposal-one','scan-A'),/stale|scan|approved/i);
});
test('bounded pending proposals reject unbounded unactioned preview creation',()=>{
 const gate=new ProposalApprovalGate();
 for(let i=0;i<100;i++)gate.register('proposal-'+i,'scan-A');
 assert.throws(()=>gate.register('overflow','scan-A'),/limit|too many|capacity/i);
});


test('FR-023 approval receipts reject unbounded or control-character identities without allocating pending slots',()=>{
 const gate=new ProposalApprovalGate();
 for(const [proposalId,scanId] of [
  ['x'.repeat(10_000),'scan-A'],
  ['proposal-one','s'.repeat(10_000)],
  ['proposal\nnewline','scan-A'],
  ['proposal-one','scan\u0000private'],
  [' proposal ','scan-A'],
 ]){
  assert.throws(()=>gate.register(proposalId,scanId),
   /invalid|identity|scan|proposal|budget/i,
   'Invalid approval and scan identifiers must be rejected before storage');
 }
 assert.doesNotThrow(()=>gate.register('proposal-one','scan-A'));
 assert.doesNotThrow(()=>gate.require('proposal-one','scan-A'));
 for(let i=1;i<100;i++)gate.register('bounded-'+i,'scan-A');
 assert.throws(()=>gate.register('capacity-exceeded','scan-A'),/limit/i,
  'Only successfully validated receipts should occupy the 100-item approval budget');
});

test('approval requirement exposes the trusted freshness window for durable audit linkage',()=>{
 let current=1_000;
 const gate=new ProposalApprovalGate({now:()=>current,ttlMs:60_000});
 gate.register('proposal-one','scan-A');
 current=5_000;
 assert.deepEqual(gate.require('proposal-one','scan-A'),{checkedAt:5_000,expiresAt:61_000});
});
