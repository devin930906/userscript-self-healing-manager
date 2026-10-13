import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const safeRow={
 path:'/synthetic/ordinary.user.js',status:'parsed' as const,
 selectorCount:1,runtimeRequiredCount:0,diagnostics:[],
};
const report:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-14T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[safeRow],
};
const canary='PRIVATE_TOKEN_MUST_NOT_LEAK';
for(const [description,row] of [
 ['null row',null],
 ['number row',42],
 ['missing path',{...safeRow,path:null}],
 ['non-array diagnostics',{...safeRow,diagnostics:canary}],
 ['null diagnostic',{...safeRow,diagnostics:[null]}],
 ['object diagnostic',{...safeRow,diagnostics:[{token:canary}]}],
] as const){
 test('RG-07 static export rejects malformed row: '+description,()=>{
  const malformed={...report,items:[row]} as unknown as ScanBatchResult;
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeStaticReport(malformed,format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid static report item');
    assert.doesNotMatch(error.message,/PRIVATE_TOKEN_MUST_NOT_LEAK/);
    return true;
   });
  }
 });
}

test('RG-07 static export retains safe parsed row identity and private diagnostic redaction',()=>{
 const projected=JSON.parse(serializeStaticReport(report,'json'));
 assert.equal(projected.items[0].path,'ordinary.user.js');
 assert.equal(projected.items[0].verification.V0,'passed');
 assert.match(serializeStaticReport(report,'markdown'),/ordinary[.]user[.]js/);
});
