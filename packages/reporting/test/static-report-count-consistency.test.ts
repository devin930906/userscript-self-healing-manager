import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const valid:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-13T12:00:00.000Z',
 requestedCount:1,enumeratedCount:2,processedCount:2,passedCount:1,errorCount:1,
 items:[
  {path:'/synthetic/parsed.user.js',status:'parsed',selectorCount:1,runtimeRequiredCount:0,diagnostics:[]},
  {path:'/synthetic/failed.user.js',status:'unreadable',selectorCount:0,runtimeRequiredCount:0,diagnostics:[]},
 ],
};

test('RG-07 static reports refuse inconsistent total/result counts in both public formats',()=>{
 const mutations=[
  {...valid,enumeratedCount:1},
  {...valid,processedCount:1},
  {...valid,processedCount:3},
  {...valid,passedCount:2},
  {...valid,errorCount:0},
  {...valid,errorCount:2},
  {...valid,items:[valid.items[0]!]},{...valid,items:[...valid.items,...valid.items]},
  {...valid,items:[{...valid.items[0]!,status:'skipped' as const},valid.items[1]!]},
 ];
 for(const forged of mutations){
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeStaticReport(forged,format),
    /inconsistent|invalid|report|count/i,
    'a report must never claim a processed/passed/error count different from its rows');
  }
 }
});

test('RG-07 valid recursive scan keeps more enumerated files than requested paths',()=>{
 const json=JSON.parse(serializeStaticReport(valid,'json'));
 assert.equal(json.requestedCount,1);
 assert.equal(json.enumeratedCount,2);
 assert.equal(json.processedCount,2);
 assert.equal(json.passedCount,1);
 assert.equal(json.errorCount,1);
 assert.equal(json.items[0].verification.V0,'passed');
 assert.equal(json.items[1].verification.V0,'blocked');
 const markdown=serializeStaticReport(valid,'markdown');
 assert.match(markdown,/处理 2 项；解析成功 1；错误 1/);
});
