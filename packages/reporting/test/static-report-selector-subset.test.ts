import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const report:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-14T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[{path:'/synthetic/safe.user.js',status:'parsed',selectorCount:1,
  runtimeRequiredCount:0,diagnostics:[]}],
};

test('RG-07 cannot export more runtime-required selectors than selectors observed',()=>{
 for(const [selectors,required] of [[0,1],[1,2],[3,4]] as const){
  const input={...report,items:[{...report.items[0]!,
   selectorCount:selectors,runtimeRequiredCount:required}]};
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeStaticReport(input,format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Inconsistent static report selector counts');
    return true;
   });
  }
 }
});

test('RG-07 retains valid zero, equal, and strict-subset selector statistics',()=>{
 for(const [selectors,required] of [[0,0],[1,0],[2,2],[5,3]] as const){
  const input={...report,items:[{...report.items[0]!,
   selectorCount:selectors,runtimeRequiredCount:required}]};
  const projected=JSON.parse(serializeStaticReport(input,'json'));
  assert.equal(projected.items[0].selectorCount,selectors);
  assert.equal(projected.items[0].runtimeRequiredCount,required);
  assert.equal(projected.items[0].verification.V4,'not-configured');
  assert.match(serializeStaticReport(input,'markdown'),/未运行网页功能测试/);
 }
});
