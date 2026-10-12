import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeDomBatchReport} from '../src/dom-report.ts';
import type {BatchDomResult,BatchDomItem} from '../../scan-service/src/batch-dom.ts';

const verified={
 V0:'passed' as const,V1:'passed' as const,V2:'blocked' as const,
 V3:'not-configured' as const,V4:'not-configured' as const,
 highestVerified:'V1' as const,functionalVerified:false as const,
 managerVerified:false as const,
};
const base:BatchDomItem={
 index:0,scriptId:'fixture-script',path:'/private/synthetic-fixture.user.js',
 status:'dom-present',checked:1,found:1,missing:0,needsReview:0,verification:verified,
};
const date='2026-10-12T05:00:00.000Z';
const report=(row:BatchDomItem):BatchDomResult=>({
 validationLevel:'dom-only',pageTargetId:'fixture-target',
 pageUrl:'https://fixture.example.invalid/page?redact=anything',
 totalItems:1,items:[row],
});
const expectReject=(row:BatchDomItem)=>{
 for(const format of ['json','markdown'] as const){
  assert.throws(()=>serializeDomBatchReport(report(row),format,date),
   /invalid|inconsistent|contradict|unsupported|evidence|verification/i,
   format+' '+JSON.stringify(row));
 }
};

test('RG-07 DOM export never accepts impossible V0 to V1 escalation or invented V1 status',()=>{
 expectReject({...base,verification:{...verified,V0:'failed'}});
 expectReject({...base,verification:{...verified,V0:'blocked'}});
 expectReject({...base,verification:{...verified,V1:'not-configured',highestVerified:'V0'}});
 expectReject({...base,status:'no-evidence',checked:0,found:0,
  verification:{...verified,V1:'blocked',highestVerified:'V0'}});
});

test('RG-07 direct DOM export rejects impossible row status and unprobed selector budgets',()=>{
 expectReject({...base,status:'error',verification:{...verified,V1:'blocked',
  highestVerified:'V0'}});
 expectReject({...base,status:'no-evidence',checked:1,found:1,
  verification:{...verified,V1:'blocked',highestVerified:'V0'}});
 expectReject({...base,status:'needs-review',checked:1,found:1,
  verification:{...verified,V1:'blocked',highestVerified:'V0'}});
 expectReject({...base,status:'needs-review',checked:0,found:0,needsReview:51,
  verification:{...verified,V1:'blocked',highestVerified:'V0'}});
});

test('RG-07 valid V1 pass, unknown review and failed static scan remain exportable',()=>{
 for(const row of [
  base,
  {...base,status:'needs-review',checked:0,found:0,needsReview:3,
   verification:{...verified,V1:'blocked',highestVerified:'V0'}},
  {...base,status:'skipped',checked:0,found:0,
   verification:{...verified,V0:'failed',V1:'blocked',highestVerified:null}},
 ] as BatchDomItem[]){
  for(const format of ['json','markdown'] as const){
   const result=serializeDomBatchReport(report(row),format,date);
   assert.match(result,/synthetic-fixture\.user\.js/);
   assert.doesNotMatch(result,/\/private\//);
   assert.doesNotMatch(result,/redact=anything/);
  }
 }
});
