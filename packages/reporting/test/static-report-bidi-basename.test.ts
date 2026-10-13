import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const baseline:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-14T01:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[{path:'/synthetic/safe.user.js',status:'parsed',selectorCount:0,
  runtimeRequiredCount:0,diagnostics:[]}],
};

test('RG-07 JSON and Markdown filenames neutralize invisible bidi controls before display',()=>{
 const bidi=['\u061c','\u200e','\u200f','\u202a','\u202b','\u202c','\u202d','\u202e',
  '\u2066','\u2067','\u2068','\u2069'];
 const injected='pre'+bidi.join('')+'fix.user.js';
 const input:ScanBatchResult={...baseline,items:[{...baseline.items[0]!,
  path:'/synthetic/PRIVATE_ACCOUNT_DIRECTORY/'+injected}]};
 const json=serializeStaticReport(input,'json');
 const markdown=serializeStaticReport(input,'markdown');
 const parsed=JSON.parse(json);
 assert.doesNotMatch(json,/PRIVATE_ACCOUNT_DIRECTORY/,
  'never expose private ancestor names in machine-readable JSON');
 assert.doesNotMatch(markdown,/PRIVATE_ACCOUNT_DIRECTORY/,
  'never expose private ancestor names in Markdown');
 for(const control of bidi)
  assert.equal(markdown.includes(control),false,
   'display Markdown must not contain directional control U+'+control.codePointAt(0)?.toString(16));
 assert.equal(parsed.items[0].path,injected,
  'retain the existing raw basename identity in JSON for downstream round trips');
 assert.ok(markdown.includes('U+61C'),'Arabic letter mark should be visible as a control label');
 assert.equal(parsed.items[0].verification.V0,'passed');
 assert.equal(parsed.items[0].verification.V4,'not-configured');
 assert.ok(markdown.includes('fix.user.js'),'Markdown should retain readable filename text');
});

test('RG-07 ordinary Unicode basenames and diagnostic redaction retain their public contract',()=>{
 const path='/PRIVATE_HOME/中文文件😀.user.js';
 const report:ScanBatchResult={...baseline,items:[{
  ...baseline.items[0]!,path,diagnostics:['PRIVATE_TOKEN=secret'],
 }]};
 const json=JSON.parse(serializeStaticReport(report,'json'));
 assert.equal(json.items[0].path,'中文文件😀.user.js');
 assert.deepEqual(json.items[0].diagnostics,['STATIC_DIAGNOSTIC_REDACTED']);
 assert.doesNotMatch(serializeStaticReport(report,'markdown'),/PRIVATE_HOME|PRIVATE_TOKEN/);
});
