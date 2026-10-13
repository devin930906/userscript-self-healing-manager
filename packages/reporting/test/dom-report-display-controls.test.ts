import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeDomBatchReport} from '../src/dom-report.ts';
import type {BatchDomResult} from '../../scan-service/src/batch-dom.ts';

const createdAt='2026-10-13T12:30:00.000Z';
const forbiddenDisplayControls=/[\r\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const makeReport=(names:string[]):BatchDomResult=>({
 validationLevel:'dom-only',pageTargetId:'synthetic-target',
 pageUrl:'https://example.invalid/fixture?private=do-not-export',
 pageDocumentToken:'a'.repeat(64),totalItems:names.length,
 items:names.map((name,index)=>({
  index,scriptId:'synthetic-'+index,path:'/synthetic/'+name,
  status:'dom-present' as const,checked:1,found:1,missing:0,needsReview:0,
  reason:'synthetic only, not for export',
  verification:{V0:'passed' as const,V1:'passed' as const,V2:'blocked' as const,
   V3:'not-configured' as const,V4:'not-configured' as const,
   highestVerified:'V1' as const,functionalVerified:false,managerVerified:false},
 })),
});

test('RG-07 DOM Markdown neutralizes Unicode record separators and standalone CR in untrusted basenames',()=>{
 const names=['row\u2028injection.user.js','paragraph\u2029break.user.js','carriage\rreturn.user.js'];
 const markdown=serializeDomBatchReport(makeReport(names),'markdown',createdAt);
 assert.equal(forbiddenDisplayControls.test(markdown),false,
  'no filename may introduce extra visual Markdown rows or invisible record separators');
 assert.equal(markdown.split('\n').filter(line=>line.startsWith('|')).length,names.length+2,
  'exactly one header, one divider and one row per item');
 const json=JSON.parse(serializeDomBatchReport(makeReport(names),'json',createdAt));
 assert.deepEqual(json.items.map((row:{name:string})=>row.name),names,
  'machine-readable JSON retains the exact original basename identity');
});

test('RG-07 DOM Markdown neutralizes bidi filename spoofing while preserving JSON identity',()=>{
 const names=['trusted\u202eSJ.resu.user.js','isolate\u2066spoof\u2069.user.js','mark\u200frtl.user.js'];
 const markdown=serializeDomBatchReport(makeReport(names),'markdown',createdAt);
 assert.equal(forbiddenDisplayControls.test(markdown),false,
  'untrusted filename text cannot reverse or disguise the neighboring V0/V1 status cells');
 assert.match(markdown,/trusted/);
 assert.match(markdown,/resu\.user\.js/);
 assert.match(markdown,/V0.*V1.*V2.*V3.*V4/);
 const json=JSON.parse(serializeDomBatchReport(makeReport(names),'json',createdAt));
 assert.deepEqual(json.items.map((row:{name:string})=>row.name),names);
 assert.equal(markdown.includes('do-not-export'),false,
  'URL query credentials must never enter the Markdown report');
});
