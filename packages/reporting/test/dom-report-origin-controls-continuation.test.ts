import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeDomBatchReport} from '../src/dom-report.ts';
import type {BatchDomResult} from '../../scan-service/src/batch-dom.ts';

const fixture=(pageUrl:string):BatchDomResult=>({
 validationLevel:'dom-only',pageTargetId:'synthetic-target',pageUrl,
 totalItems:0,items:[],
});
const timestamp='2026-10-15T12:30:00.000Z';

test('RG-07 DOM report refuses unencoded controls and parser-normalized URL whitespace',()=>{
 const url='https://example.invalid/fixture?token=PRIVATE_VALUE';
 const invalid=[
  ...[0,9,10,13,31,127,128,133,159,0x2028,0x2029].map(code=>
   'https://example.invalid/fi'+String.fromCharCode(code)+'xture?token=PRIVATE_VALUE'),
  ' '+url,url+' ',
 ];
 for(const raw of invalid){
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeDomBatchReport(fixture(raw),format,timestamp),
    error=>error instanceof Error&&error.message==='Invalid DOM diagnosis origin',
    'raw URL must be rejected, not normalized: '+JSON.stringify(raw));
  }
 }
});

test('RG-07 DOM report exports only the origin for valid encoded URLs',()=>{
 for(const format of ['json','markdown'] as const){
  for(const path of ['/private%0Apath','/private%C2%85path','/%E6%B5%8B%E8%AF%95']){
   const output=serializeDomBatchReport(
    fixture('https://example.invalid:8443'+path+'?token=PRIVATE_VALUE'),format,timestamp);
   assert.match(output,/https:\/\/example[.]invalid:8443/);
   assert.doesNotMatch(output,/PRIVATE_VALUE|private%C2%85|private%0A/i);
  }
 }
});

test('RG-07 origin validation coexists with strict valid calendar timestamps',()=>{
 assert.throws(()=>serializeDomBatchReport(
  fixture('https://example.invalid/fixture'),'json','2026-02-30T12:30:00.000Z'),
  /Invalid diagnosis report timestamp/);
 assert.equal(JSON.parse(serializeDomBatchReport(
  fixture('https://example.invalid/fixture'),'json','2024-02-29T12:30:00.000Z')
 ).pageOrigin,'https://example.invalid');
});
