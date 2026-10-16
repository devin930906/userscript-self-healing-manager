import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const sentinel='PRIVATE_REPORT_ROOT_ACCESSOR_LEAK';
const fixture:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-16T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[{path:'/private/safe.user.js',status:'parsed',selectorCount:0,
  runtimeRequiredCount:0,diagnostics:[]}],
};

test('RG-07 static export never executes accessor-backed root metadata, counts, or items',()=>{
 const fields=[
  ['items','Invalid static report input'],
  ['scanMode','Invalid static report metadata'],
  ['createdAt','Invalid static report metadata'],
  ['requestedCount','Invalid static report count'],
  ['enumeratedCount','Invalid static report count'],
  ['processedCount','Invalid static report count'],
  ['passedCount','Invalid static report count'],
  ['errorCount','Invalid static report count'],
 ] as const;
 for(const [field,expected] of fields){
  let reads=0;
  const forged={...fixture};
  Object.defineProperty(forged,field,{enumerable:true,configurable:true,get(){
   reads++;
   throw new Error(sentinel);
  }});
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeStaticReport(forged,format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,expected);
    assert.doesNotMatch(error.message,/PRIVATE_REPORT_ROOT_ACCESSOR_LEAK/);
    return true;
   });
  }
  assert.equal(reads,0,'report field '+field+' must remain unread');
 }
});

test('RG-07 static export rejects accessor-bearing or sparse item slots before iterating',()=>{
 for(const form of ['getter','hole'] as const){
  let reads=0;
  const items=form==='getter'?[fixture.items[0]!]:new Array(1);
  if(form==='getter')Object.defineProperty(items,0,{
   enumerable:true,configurable:true,get(){
    reads++;
    throw new Error(sentinel);
   },
  });
  const forged={...fixture,items} as ScanBatchResult;
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeStaticReport(forged,format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid static report item');
    assert.doesNotMatch(error.message,/PRIVATE_REPORT_ROOT_ACCESSOR_LEAK/);
    return true;
   });
  }
  assert.equal(reads,0,'the untrusted item slot must not execute');
 }
});

test('RG-07 static export retains canonical root data and ordinary item-array compatibility',()=>{
 const report=JSON.parse(serializeStaticReport(fixture,'json'));
 assert.equal(report.createdAt,fixture.createdAt);
 assert.equal(report.items[0].path,'safe.user.js');
 assert.equal(report.items[0].verification.V4,'not-configured');
 assert.match(serializeStaticReport(fixture,'markdown'),/safe\.user\.js/);
});

test('RG-07 rejects noncanonical static report timestamps without exporting private metadata',()=>{
 // The genuine scan service supplies new Date().toISOString(). Arbitrary strings
 // must never be echoed in a JSON report or mistaken for a scan timestamp.
 for(const createdAt of [
  'https://private.example.test/account?token=SECRET_REPORT_TIME',
  'C:\\Users\\SECRET_REPORT_TIME\\scan.json',
  '2026-02-30T00:00:00.000Z',
  '2026-10-16T08:00:00.000+08:00',
  '2026-10-16T00:00:00.000Z\\nSECRET_REPORT_TIME',
 ]){
  const forged:ScanBatchResult={...fixture,createdAt};
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeStaticReport(forged,format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid static report metadata');
    assert.doesNotMatch(error.message,/SECRET_REPORT_TIME/);
    return true;
   });
  }
 }
 const genuine=JSON.parse(serializeStaticReport(fixture,'json'));
 assert.equal(genuine.createdAt,'2026-10-16T00:00:00.000Z');
});
