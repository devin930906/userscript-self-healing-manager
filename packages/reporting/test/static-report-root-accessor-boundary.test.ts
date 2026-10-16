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
