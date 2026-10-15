import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeDomBatchReport} from '../src/dom-report.ts';
import type {BatchDomResult} from '../../scan-service/src/batch-dom.ts';

const timestamp='2026-10-15T12:30:00.000Z';
const fixture=(pageUrl:string):BatchDomResult=>({
 validationLevel:'dom-only',pageTargetId:'synthetic-target',pageUrl,
 totalItems:0,items:[],
});

test('RG-07 DOM export rejects raw C1 controls before WHATWG URL normalizes them',()=>{
 for(let code=0x80;code<=0x9f;code++){
  const pageUrl='https://example.invalid/path'+String.fromCharCode(code)+'?token=PRIVATE_VALUE';
  for(const format of ['json','markdown'] as const){
   assert.throws(
    ()=>serializeDomBatchReport(fixture(pageUrl),format,timestamp),
    error=>error instanceof Error&&error.message==='Invalid DOM diagnosis origin',
    'reject raw codepoint U+'+code.toString(16).toUpperCase(),
   );
  }
 }
});

test('RG-07 permits percent-encoded C1 but never exports private URL paths or queries',()=>{
 for(const format of ['json','markdown'] as const){
  const output=serializeDomBatchReport(
   fixture('https://example.invalid:8443/path%C2%80?token=PRIVATE_VALUE'),
   format,timestamp);
  assert.match(output,/https:\/\/example[.]invalid:8443/);
  assert.doesNotMatch(output,/PRIVATE_VALUE|path%C2%80/);
 }
});
