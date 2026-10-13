import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';
import {serializeStaticReport} from '../src/index.ts';

test('RG-07 static Markdown timestamp neutralizes terminal escape and erase controls without altering JSON',()=>{
 const createdAt='2026-10-13T14:00:00Z\\u001b[8mHIDDEN\\u001b[0m\\bBACKSPACE\\fFORMFEED\\u007fDEL'
  .replace(/\\u001b/g,'\\x1b').replace(/\\u007f/g,'\\x7f');
 const timestamp=createdAt.replace(/\\x1b/g,'\x1b').replace(/\\b/g,'\b').replace(/\\f/g,'\f').replace(/\\x7f/g,'\x7f');
 const source:ScanBatchResult={
  scanMode:'static-only',createdAt:timestamp,requestedCount:1,enumeratedCount:1,
  processedCount:1,passedCount:1,errorCount:0,
  items:[{path:'C:\\\\synthetic\\\\ordinary.user.js',status:'parsed',
   selectorCount:0,runtimeRequiredCount:0,diagnostics:[]}],
 };
 const output=serializeStaticReport(source,'markdown');
 const line=output.split('\\n').find(text=>text.startsWith('创建时间：'))??'';
 assert.ok(line,'the timestamp should remain present in Markdown');
 assert.doesNotMatch(line,/[\\u0000-\\u001f\\u007f]/u,
  'a terminal control cannot hide, erase or recolor report audit labels');
 assert.match(line,/HIDDEN/);
 assert.match(line,/BACKSPACE/);
 assert.match(line,/FORMFEED/);
 assert.match(line,/DEL/);
 assert.equal(JSON.parse(serializeStaticReport(source,'json')).createdAt,timestamp,
  'machine-readable timestamp remains the original value');
});
