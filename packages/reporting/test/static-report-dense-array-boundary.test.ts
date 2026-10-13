import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult,ScanItemResult} from '../../scan-service/src/index.ts';

const item:ScanItemResult={
 path:'/synthetic/safe.user.js',status:'parsed',selectorCount:1,
 runtimeRequiredCount:0,diagnostics:['PRIVATE_SCRIPT_SOURCE_MUST_NOT_LEAK'],
};
const baseline:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-14T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[item],
};

test('RG-07 static export rejects sparse item arrays instead of publishing ghost JSON rows',()=>{
 const items=new Array<ScanItemResult>(1);
 const forged:ScanBatchResult={...baseline,items,passedCount:0};
 for(const format of ['json','markdown'] as const)
  assert.throws(()=>serializeStaticReport(forged,format),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid static report item');
   return true;
  },'missing row cannot count as one processed item');
});

test('RG-07 static export rejects sparse diagnostic arrays instead of publishing null evidence',()=>{
 const diagnostics=new Array<string>(1);
 const forged:ScanBatchResult={...baseline,items:[{...item,diagnostics}]};
 for(const format of ['json','markdown'] as const)
  assert.throws(()=>serializeStaticReport(forged,format),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid static report item');
   return true;
  },'missing diagnostic is not a valid string entry');
});

test('RG-07 dense reports preserve safe diagnostic counts and redact raw text',()=>{
 const json=JSON.parse(serializeStaticReport(baseline,'json'));
 assert.equal(json.items.length,1);
 assert.deepEqual(json.items[0].diagnostics,['STATIC_DIAGNOSTIC_REDACTED']);
 assert.equal(json.items[0].status,'parsed');
 assert.equal(json.processedCount,1);
 assert.equal(json.items[0].verification.V4,'not-configured');
 const markdown=serializeStaticReport(baseline,'markdown');
 assert.match(markdown,/safe\\.user\\.js/);
 assert.match(markdown,/STATIC_DIAGNOSTIC_REDACTED/);
 assert.doesNotMatch(markdown,/PRIVATE_SCRIPT_SOURCE_MUST_NOT_LEAK/);
});
