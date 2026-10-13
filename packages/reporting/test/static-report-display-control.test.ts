import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';
import {serializeStaticReport} from '../src/index.ts';

const forbiddenDisplayControls=/[\r\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
function fixture(createdAt:string,path:string):ScanBatchResult{
 return {
  scanMode:'static-only',createdAt,
  requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
  items:[{path,status:'parsed',selectorCount:0,runtimeRequiredCount:0,diagnostics:[]}],
 };
}
test('RG-07 Markdown timestamp cannot smuggle CR or Unicode line separators into report rows',()=>{
 const createdAt='2026-10-13T09:00:00Z\r| forged report row | V4 passed |\u2028FAKE-HEADER\u2029';
 const output=serializeStaticReport(fixture(createdAt,'C:\\scripts\\ordinary.user.js'),'markdown');
 assert.equal(forbiddenDisplayControls.test(output),false,
  'the visible Markdown report must not contain raw record delimiters or directional controls');
 assert.match(output,/forged report row/);
 assert.match(output,/FAKE-HEADER/);
 assert.equal(output.split('\n').filter(x=>x.startsWith('|')).length,3,
  'only the normal Markdown table header, divider and one item may exist');
 const json=JSON.parse(serializeStaticReport(fixture(createdAt,'C:\\scripts\\ordinary.user.js'),'json'));
 assert.equal(json.createdAt,createdAt,'JSON source field contract remains unchanged');
});
test('RG-07 Markdown neutralizes bidirectional basename spoofing without losing JSON basename identity',()=>{
 const name='trusted\u202eSJ.resu.user.js';
 const output=serializeStaticReport(fixture('2026-10-13T09:00:00Z','C:\\scripts\\'+name),'markdown');
 assert.equal(forbiddenDisplayControls.test(output),false,
  'the displayed Markdown basename may not reverse or reorder neighboring status cells');
 assert.match(output,/trusted/);
 assert.match(output,/resu\.user\.js/);
 const json=JSON.parse(serializeStaticReport(fixture('2026-10-13T09:00:00Z','C:\\scripts\\'+name),'json'));
 assert.equal(json.items[0].path,name,'preserve raw filename identity in machine-readable JSON');
});
