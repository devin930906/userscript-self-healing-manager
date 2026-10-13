import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const report:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-13T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[{path:'/synthetic/test.user.js',status:'parsed',selectorCount:1,
  runtimeRequiredCount:0,diagnostics:[]}],
};
const forge=(status:unknown):ScanBatchResult=>({
 ...report,items:[{...report.items[0]!,status:status as ScanBatchResult['items'][number]['status']}],
});

test('RG-07 public static JSON and Markdown exports reject untrusted invalid scan statuses',()=>{
 for(const invalid of [
  '![report-beacon](https://collector.invalid/pixel)',
  'parsed\\n| forged | passed | 99 | 0 | pass |',
  'parsed ', '', null, 0,
 ]){
  for(const format of ['markdown','json'] as const){
   assert.throws(
    ()=>serializeStaticReport(forge(invalid),format),
    /invalid|status|report/i,
    'reject runtime-forged status instead of embedding it in a trust-bearing report',
   );
  }
 }
});

test('RG-07 report status validation retains each exact legitimate static-scan status',()=>{
 for(const status of ['parsed','parse-error','unreadable','skipped'] as const){
  // A valid status sample must also carry the corresponding truthful
  // report-level totals; forged-count rejection has its own RED regression.
  const input:ScanBatchResult={
   ...forge(status),
   passedCount:status==='parsed'?1:0,
   errorCount:status==='parse-error'||status==='unreadable'?1:0,
  };
  const json=JSON.parse(serializeStaticReport(input,'json'));
  assert.equal(json.items[0].status,status);
  assert.equal(json.items[0].verification.V0,
   status==='parsed'?'passed':status==='parse-error'?'failed':status==='skipped'?'skipped':'blocked');
  const markdown=serializeStaticReport(input,'markdown');
  assert.ok(markdown.includes('| '+status+' |'),'report must retain the exact safe status '+status);
 }
});
