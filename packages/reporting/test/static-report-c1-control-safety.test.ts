import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

// Eight-bit C1 controls (notably NEL U+0085 and CSI U+009B) are invisible
// or active in some report viewers. JSON retains the original basename.
test('RG-07 Markdown neutralizes every C1 control without changing JSON identity',()=>{
 for(let cp=0x80;cp<=0x9f;cp++){
  const mark=String.fromCodePoint(cp);
  const name='report'+mark+'-safe.user.js';
  const report:ScanBatchResult={
   scanMode:'static-only',createdAt:'2026-10-14T00:00:00.000Z',
   requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
   items:[{path:'/synthetic/'+name,status:'parsed',selectorCount:0,
    runtimeRequiredCount:0,diagnostics:[]}],
  };
  const markdown=serializeStaticReport(report,'markdown');
  assert.equal(markdown.includes(mark),false,
   'raw C1 control U+'+cp.toString(16).toUpperCase()+' must not survive human-visible Markdown');
  assert.ok(markdown.includes('report'),
   'ordinary readable filename text should be preserved');
  const json=JSON.parse(serializeStaticReport(report,'json'));
  assert.equal(json.items[0].path,name,'machine-readable basename must remain unchanged');
  assert.equal(json.items[0].verification.V4,'not-configured');
 }
});

test('RG-07 C1 filtering keeps Unicode basenames and diagnostic redaction intact',()=>{
 const name='电影🎬-résumé.user.js';
 const report:ScanBatchResult={
  scanMode:'static-only',createdAt:'2026-10-14T00:00:00.000Z',
  requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:0,errorCount:1,
  items:[{path:'C:\\synthetic\\'+name,status:'unreadable',
   selectorCount:0,runtimeRequiredCount:0,diagnostics:['SECRET_NEVER_EXPORT']}],
 };
 const markdown=serializeStaticReport(report,'markdown');
 assert.match(markdown,/电影🎬-résumé[.]user[.]js/);
 assert.doesNotMatch(markdown,/SECRET_NEVER_EXPORT/);
 assert.match(markdown,/STATIC_DIAGNOSTIC_REDACTED/);
 assert.equal(JSON.parse(serializeStaticReport(report,'json')).items[0].path,name);
});
