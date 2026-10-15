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
 const privateMarker='PRIVATE_QUERY_MUST_NOT_EXPORT';
 const unsafe=[
  'https://example.invalid/fi\\nxture?token='+privateMarker,
  'https://example.invalid/fi\\rxture?token='+privateMarker,
  'https://example.invalid/fi\\txture?token='+privateMarker,
  'https://example.invalid/fi\\u0000xture?token='+privateMarker,
  'https://example.invalid/fi\\u007fxture?token='+privateMarker,
  ' https://example.invalid/fixture?token='+privateMarker,
  'https://example.invalid/fixture?token='+privateMarker+' ',
 ];
 for(const input of unsafe){
  const raw=input.replace('\\\\n','\\n').replace('\\\\r','\\r')
   .replace('\\\\t','\\t').replace('\\\\u0000','\\u0000')
   .replace('\\\\u007f','\\u007f');
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
  assert.match(result,/https:\\/\\/example\\.invalid:8443/);
  assert.doesNotMatch(result,/PRIVATE_QUERY_MUST_NOT_EXPORT|private%0Apath/i);
 }
 const parsed=JSON.parse(serializeDomBatchReport(fixture(input),'json',timestamp));
 assert.equal(parsed.pageOrigin,'https://example.invalid:8443');
 assert.equal(parsed.processedCount,0);
});
