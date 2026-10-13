import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const oneRow:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-14T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[{path:'/synthetic/safe.user.js',status:'parsed',selectorCount:0,
  runtimeRequiredCount:0,diagnostics:[]}],
};

test('RG-07 static export cannot invent scanned items when zero paths were requested',()=>{
 const impossible={...oneRow,requestedCount:0};
 for(const format of ['json','markdown'] as const){
  assert.throws(()=>serializeStaticReport(impossible,format),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Inconsistent static report request count');
   return true;
  });
 }
});

test('RG-07 preserves genuine empty selection and empty folder inventory',()=>{
 for(const requestedCount of [0,1]){
  const empty:ScanBatchResult={...oneRow,requestedCount,enumeratedCount:0,
   processedCount:0,passedCount:0,errorCount:0,items:[]};
  const json=JSON.parse(serializeStaticReport(empty,'json'));
  assert.equal(json.requestedCount,requestedCount);
  assert.equal(json.processedCount,0);
  assert.deepEqual(json.items,[]);
  assert.match(serializeStaticReport(empty,'markdown'),/处理 0 项/);
 }
});

test('RG-07 preserves recursive expansion into more rows than requested root paths',()=>{
 const recursive:ScanBatchResult={...oneRow,requestedCount:1,enumeratedCount:2,
  processedCount:2,passedCount:2,items:[oneRow.items[0]!,{
   ...oneRow.items[0]!,path:'/synthetic/other.user.js',
  }]};
 const json=JSON.parse(serializeStaticReport(recursive,'json'));
 assert.equal(json.requestedCount,1);
 assert.equal(json.processedCount,2);
 assert.equal(json.items.length,2);
});
