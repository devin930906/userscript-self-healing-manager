import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

// Deprecated Unicode bidi format controls can reorder or obscure audit names.
// Retain raw JSON basename identity; neutralize only human-visible Markdown.
test('RG-07 Markdown neutralizes deprecated U+206A..U+206F bidi controls in a script basename',()=>{
 for(let cp=0x206a;cp<=0x206f;cp++){
  const mark=String.fromCodePoint(cp);
  const name='sample'+mark+'-script.user.js';
  const report:ScanBatchResult={
   scanMode:'static-only',createdAt:'2026-10-14T00:00:00.000Z',
   requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
   items:[{path:'/synthetic/'+name,status:'parsed',
    selectorCount:1,runtimeRequiredCount:0,diagnostics:[]}],
  };
  const markdown=serializeStaticReport(report,'markdown');
  assert.equal(markdown.includes(mark),false,
   'invisible U+'+cp.toString(16).toUpperCase()+' must not survive a human-facing report');
  assert.ok(markdown.includes('\\[U+'+cp.toString(16).toUpperCase()+'\\]'),
   'show a readable marker for the original bidi control');
  const json=JSON.parse(serializeStaticReport(report,'json'));
  assert.equal(json.items[0].path,name,'preserve JSON basename identity');
  assert.equal(json.items[0].verification.V4,'not-configured');
 }
});

test('RG-07 Markdown keeps ordinary multilingual basenames legible and diagnostics redacted',()=>{
 const name='电影🎬-résumé.user.js';
 const report:ScanBatchResult={
  scanMode:'static-only',createdAt:'2026-10-14T00:00:00.000Z',
  requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:0,errorCount:1,
  items:[{path:'C:\\synthetic\\'+name,status:'unreadable',
   selectorCount:0,runtimeRequiredCount:0,diagnostics:['PRIVATE_KEY_DO_NOT_EXPORT']}],
 };
 const markdown=serializeStaticReport(report,'markdown');
 assert.match(markdown,/电影🎬-résumé[.]user[.]js/);
 assert.doesNotMatch(markdown,/PRIVATE_KEY_DO_NOT_EXPORT/);
 assert.match(markdown,/STATIC_DIAGNOSTIC_REDACTED/);
 assert.equal(JSON.parse(serializeStaticReport(report,'json')).items[0].path,name);
});
