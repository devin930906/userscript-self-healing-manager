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
