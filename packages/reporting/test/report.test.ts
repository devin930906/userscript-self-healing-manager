import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';
const report:ScanBatchResult={scanMode:'static-only',createdAt:'2026-10-08T10:00:00.000Z',requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,items:[{path:'D:\\私有\\test.user.js',status:'parsed',selectorCount:1,runtimeRequiredCount:0,diagnostics:[]}]};
test('JSON report exposes static-only confidence and counts without script source',()=>{
 const r=JSON.parse(serializeStaticReport(report,'json'));
 assert.equal(r.scanMode,'static-only');assert.equal(r.schemaVersion,2);assert.equal(r.items.length,1);
 assert.equal(serializeStaticReport(report,'json').includes('apiKey'),false);
});
test('Markdown escapes HTML and warns functional verification was not performed',()=>{
 const r=serializeStaticReport({...report,items:[{...report.items[0]!,path:'<img onerror=alert(1)>.user.js'}]},'markdown');
 assert.match(r,/未运行网页功能测试/);assert.doesNotMatch(r,/<img/);
});

test('export explicitly stores every V0-V4 status and never upgrades static data into a live pass',()=>{
 const json=JSON.parse(serializeStaticReport(report,'json'));
 assert.equal(json.schemaVersion,2);
 assert.deepEqual(json.items[0].verification,{
  V0:'passed',V1:'blocked',V2:'blocked',V3:'not-configured',V4:'not-configured',
  highestVerified:'V0',functionalVerified:false,managerVerified:false,
 });
 const markdown=serializeStaticReport(report,'markdown');
 assert.match(markdown,/V0/);
 assert.match(markdown,/V4/);
 assert.match(markdown,/未配置|not-configured/);
});
