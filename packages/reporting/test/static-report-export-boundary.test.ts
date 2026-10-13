import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

/** Fixed synthetic report: never export real paths or user scripts. */
const fixture:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-14T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[{path:'/synthetic/safe.user.js',status:'parsed',
  selectorCount:0,runtimeRequiredCount:0,diagnostics:[]}],
};

test('RG-07 static report rejects unsupported runtime output formats',()=>{
 for(const format of ['html','xml','',null]){
  assert.throws(
   ()=>serializeStaticReport(fixture,format as 'json'),
   /Invalid static report format/,
   'unknown format must never silently fall back to Markdown');
 }
});

test('RG-07 static report rejects absent or malformed rows with a privacy-safe error',()=>{
 for(const unsafe of [null,{}, {...fixture,items:null}, {...fixture,items:'not-an-array'}]){
  assert.throws(
   ()=>serializeStaticReport(unsafe as ScanBatchResult,'json'),
   /Invalid static report input/,
   'an untrusted runtime payload must not produce an accidental export');
 }
});

test('RG-07 static report preserves valid JSON and Markdown exports',()=>{
 const json=JSON.parse(serializeStaticReport(fixture,'json'));
 assert.equal(json.items[0].path,'safe.user.js');
 assert.match(serializeStaticReport(fixture,'markdown'),/safe[.]user[.]js/);
});
