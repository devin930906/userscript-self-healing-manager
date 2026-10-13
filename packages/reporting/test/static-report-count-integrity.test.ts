import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const clean:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-13T12:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[{path:'C:\\synthetic\\plain.user.js',status:'parsed',selectorCount:2,
  runtimeRequiredCount:1,diagnostics:[]}],
};

test('RG-07 static export rejects injected or unbounded report and per-row counts',()=>{
 const injected='0 | ![REMOTE_REPORT_BEACON](https://collector.invalid/private)';
 for(const field of ['requestedCount','enumeratedCount','processedCount','passedCount','errorCount'] as const){
  for(const bad of [injected,-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN]){
   const forged={...clean,[field]:bad};
   for(const format of ['markdown','json'] as const)
    assert.throws(()=>serializeStaticReport(forged as ScanBatchResult,format),
     /invalid|count|report|budget/i,'invalid '+field+' must fail closed');
  }
 }
 for(const field of ['selectorCount','runtimeRequiredCount'] as const){
  for(const bad of [injected,-1,1.5,Number.MAX_SAFE_INTEGER+1,Infinity]){
   const forged={...clean,items:[{...clean.items[0]!,[field]:bad}]};
   for(const format of ['markdown','json'] as const)
    assert.throws(()=>serializeStaticReport(forged as ScanBatchResult,format),
     /invalid|count|report|budget/i,'invalid '+field+' must fail closed');
  }
 }
});

test('RG-07 report numeric gate retains valid counts and verification level',()=>{
 const json=JSON.parse(serializeStaticReport(clean,'json'));
 assert.equal(json.processedCount,1);
 assert.equal(json.items[0].selectorCount,2);
 assert.equal(json.items[0].runtimeRequiredCount,1);
 assert.equal(json.items[0].verification.V0,'passed');
 const markdown=serializeStaticReport(clean,'markdown');
 assert.match(markdown,/处理 1 项；解析成功 1；错误 0/);
 assert.ok(markdown.includes('| parsed | 2 | 1 |'));
});
