import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeDomBatchReport} from '../src/dom-report.ts';
import type {BatchDomResult} from '../../scan-service/src/batch-dom.ts';

const fixture=(pageUrl:string):BatchDomResult=>({
 validationLevel:'dom-only',pageTargetId:'synthetic-target',pageUrl,
 totalItems:0,items:[],
});
const timestamp='2026-10-15T12:30:00.000Z';

test('RG-07 DOM report rejects URL parser normalization of raw controls and whitespace',()=>{
 const secret='PRIVATE_QUERY_MUST_NOT_EXPORT';
 const unsafe=[
  ...[0,9,10,13,31,127].map(code=>
   'https://example.invalid/fi'+String.fromCharCode(code)+'xture?token='+secret),
  ' https://example.invalid/fixture?token='+secret,
  'https://example.invalid/fixture?token='+secret+' ',
 ];
 for(const raw of unsafe){
  for(const format of ['json','markdown'] as const)
   assert.throws(()=>serializeDomBatchReport(fixture(raw),format,timestamp),
    error=>error instanceof Error&&error.message==='Invalid DOM diagnosis origin',
    'report must reject a raw URL the parser would normalize: '+JSON.stringify(raw));
 }
});

test('RG-07 DOM export preserves genuine encoded URLs and origin-only projection',()=>{
 const input='https://example.invalid:8443/private%0Apath?token=PRIVATE_QUERY_MUST_NOT_EXPORT';
 for(const format of ['json','markdown'] as const){
  const result=serializeDomBatchReport(fixture(input),format,timestamp);
  assert.ok(result.includes('https://example.invalid:8443'));
  assert.doesNotMatch(result,/PRIVATE_QUERY_MUST_NOT_EXPORT|private%0Apath/i);
 }
 const parsed=JSON.parse(serializeDomBatchReport(fixture(input),'json',timestamp));
 assert.equal(parsed.pageOrigin,'https://example.invalid:8443');
 assert.equal(parsed.processedCount,0);
});
