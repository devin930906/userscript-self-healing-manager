import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const baseline:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-14T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[{path:'/synthetic/safe.user.js',status:'parsed',selectorCount:0,
  runtimeRequiredCount:0,diagnostics:[]}],
};

const privateMarker='PRIVATE_METADATA_MUST_NOT_LEAK';
test('RG-07 static export rejects forged scanMode instead of relabeling live evidence as static',()=>{
 for(const bad of ['gm-v4-passed','',null,42,{token:privateMarker}]){
  const input={...baseline,scanMode:bad} as unknown as ScanBatchResult;
  for(const format of ['json','markdown'] as const)
   assert.throws(()=>serializeStaticReport(input,format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid static report metadata');
    assert.doesNotMatch(error.message,/PRIVATE_METADATA_MUST_NOT_LEAK/);
    return true;
   });
 }
});

test('RG-07 static export rejects non-string creation timestamps with a fixed private error',()=>{
 for(const bad of [null,undefined,0,{},[],{token:privateMarker}]){
  const input={...baseline,createdAt:bad} as unknown as ScanBatchResult;
  for(const format of ['json','markdown'] as const)
   assert.throws(()=>serializeStaticReport(input,format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid static report metadata');
    assert.doesNotMatch(error.message,/PRIVATE_METADATA_MUST_NOT_LEAK/);
    return true;
   });
 }
});

test('RG-07 static export preserves valid metadata and the existing arbitrary-string timestamp contract',()=>{
 const timestamp='synthetic timestamp ![text](https://fixture.invalid)';
 const input={...baseline,createdAt:timestamp};
 const json=JSON.parse(serializeStaticReport(input,'json'));
 assert.equal(json.scanMode,'static-only');
 assert.equal(json.createdAt,timestamp);
 assert.match(serializeStaticReport(input,'markdown'),/synthetic timestamp/);
 assert.equal(json.items[0].verification.V4,'not-configured');
});
