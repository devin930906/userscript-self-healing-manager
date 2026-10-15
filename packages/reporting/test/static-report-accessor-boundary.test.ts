import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const row={
 path:'/PRIVATE_ACCOUNT/synthetic.user.js',status:'parsed' as const,
 selectorCount:0,runtimeRequiredCount:0,diagnostics:[],
};
const fixture:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-16T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[row],
};
const sentinel='PRIVATE_GETTER_ERROR_MUST_NOT_LEAK';

test('RG-07 static export refuses accessor-owned row properties without running getters',()=>{
 for(const key of ['path','status','selectorCount','runtimeRequiredCount','diagnostics'] as const){
  let calls=0;
  const forged={...row} as Record<string,unknown>;
  Object.defineProperty(forged,key,{
   enumerable:true,configurable:true,get(){
    calls++;
    throw new Error(sentinel);
   },
  });
  const input={...fixture,items:[forged]} as unknown as ScanBatchResult;
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeStaticReport(input,format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid static report item');
    assert.doesNotMatch(error.message,/PRIVATE_GETTER_ERROR_MUST_NOT_LEAK/);
    return true;
   },key+' must be rejected before reading private fields');
  }
  assert.equal(calls,0,key+' getter must never be evaluated');
 }
});

test('RG-07 static export refuses accessor-owned diagnostics without evaluating private messages',()=>{
 let calls=0;
 const diagnostics:string[]=['placeholder'];
 Object.defineProperty(diagnostics,0,{enumerable:true,configurable:true,get(){
  calls++;
  throw new Error(sentinel);
 }});
 const input={...fixture,items:[{...row,diagnostics}]} as ScanBatchResult;
 for(const format of ['json','markdown'] as const){
  assert.throws(()=>serializeStaticReport(input,format),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid static report item');
   assert.doesNotMatch(error.message,/PRIVATE_GETTER_ERROR_MUST_NOT_LEAK/);
   return true;
  });
 }
 assert.equal(calls,0,'private diagnostic getter must not be evaluated');
});

test('RG-07 ordinary data-only report preserves existing JSON/Markdown shape',()=>{
 const json=JSON.parse(serializeStaticReport(fixture,'json'));
 assert.equal(json.items[0].path,'synthetic.user.js');
 assert.equal(json.items[0].status,'parsed');
 assert.deepEqual(json.items[0].diagnostics,[]);
 assert.match(serializeStaticReport(fixture,'markdown'),/synthetic\.user\.js/);
});
