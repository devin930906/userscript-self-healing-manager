import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const secret='PRIVATE_ARRAY_METHOD_GETTER_MUST_NOT_LEAK';
const fixture:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-16T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[{path:'/private/ok.user.js',status:'parsed',
  selectorCount:0,runtimeRequiredCount:0,diagnostics:['fixed diagnostic']}],
};

test('RG-07 static report refuses accessor-shadowed item array methods before calling them',()=>{
 for(const method of ['every','filter','map']){
  const items=[fixture.items[0]!];
  let calls=0;
  Object.defineProperty(items,method,{configurable:true,get(){
   calls++;
   throw new Error(secret);
  }});
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeStaticReport({...fixture,items},format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid static report item');
    assert.doesNotMatch(error.message,/PRIVATE_ARRAY_METHOD_GETTER_MUST_NOT_LEAK/);
    return true;
   });
  }
  assert.equal(calls,0,'array.'+method+' must never be invoked on untrusted input');
 }
});

test('RG-07 static report refuses accessor-shadowed diagnostic map before rendering',()=>{
 let calls=0;
 const diagnostics=['fixed diagnostic'];
 Object.defineProperty(diagnostics,'map',{configurable:true,get(){
  calls++;
  throw new Error(secret);
 }});
 const input:ScanBatchResult={...fixture,items:[{...fixture.items[0]!,diagnostics}]};
 for(const format of ['json','markdown'] as const){
  assert.throws(()=>serializeStaticReport(input,format),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid static report item');
   assert.doesNotMatch(error.message,/PRIVATE_ARRAY_METHOD_GETTER_MUST_NOT_LEAK/);
   return true;
  });
 }
 assert.equal(calls,0);
});

test('RG-07 ordinary item and diagnostic array methods remain compatible',()=>{
 const json=JSON.parse(serializeStaticReport(fixture,'json'));
 assert.equal(json.items[0].path,'ok.user.js');
 assert.deepEqual(json.items[0].diagnostics,['STATIC_DIAGNOSTIC_REDACTED']);
 assert.match(serializeStaticReport(fixture,'markdown'),/ok\.user\.js/);
});
