import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';
const report:ScanBatchResult={scanMode:'static-only',createdAt:'2026-10-08T10:00:00.000Z',requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,items:[{path:'D:\\私有\\test.user.js',status:'parsed',selectorCount:1,runtimeRequiredCount:0,diagnostics:[]}]};
test('JSON report exposes static-only confidence and counts without script source',()=>{
 const r=JSON.parse(serializeStaticReport(report,'json'));
 assert.equal(r.scanMode,'static-only');assert.equal(r.schemaVersion,1);assert.equal(r.items.length,1);
 assert.equal(serializeStaticReport(report,'json').includes('apiKey'),false);
});
test('Markdown escapes HTML and warns functional verification was not performed',()=>{
 const r=serializeStaticReport({...report,items:[{...report.items[0]!,path:'<img onerror=alert(1)>.user.js'}]},'markdown');
 assert.match(r,/未运行网页功能测试/);assert.doesNotMatch(r,/<img/);
});
