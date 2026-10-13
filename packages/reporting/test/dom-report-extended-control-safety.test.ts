import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeDomBatchReport} from '../src/dom-report.ts';
import type {BatchDomResult} from '../../scan-service/src/batch-dom.ts';

const timestamp='2026-10-14T00:00:00.000Z';
function fixture(name:string):BatchDomResult{
 return {
  validationLevel:'dom-only',
  pageTargetId:'synthetic-only',
  pageUrl:'https://example.invalid/fixture?private=DO_NOT_EXPORT',
  pageDocumentToken:'a'.repeat(64),
  totalItems:1,
  items:[{
   index:0,scriptId:'synthetic-1',path:'/synthetic/'+name,
   status:'dom-present',checked:1,found:1,missing:0,needsReview:0,
   reason:'private DOM fixture',
   verification:{
    V0:'passed',V1:'passed',V2:'blocked',
    V3:'not-configured',V4:'not-configured',highestVerified:'V1',
    functionalVerified:false,managerVerified:false,
   },
  }],
 };
}

// A displayed DOM audit row must not behave less safely than the existing
// static report when a basename includes a Unicode terminal/bidi control.
test('RG-07 DOM Markdown rejects raw C1 and extended bidi display controls',()=>{
 const codepoints=[
  ...Array.from({length:32},(_,i)=>0x80+i),
  0x061c,
  ...Array.from({length:6},(_,i)=>0x206a+i),
 ];
 for(const cp of codepoints){
  const control=String.fromCodePoint(cp);
  const name='trusted'+control+'-script.user.js';
  const report=fixture(name);
  const markdown=serializeDomBatchReport(report,'markdown',timestamp);
  assert.equal(markdown.includes(control),false,
   'raw Unicode U+'+cp.toString(16).toUpperCase()+' must not appear in Markdown audit rows');
  assert.match(markdown,/trusted/);
  assert.match(markdown,/V0.*V1.*V2.*V3.*V4/);
  assert.doesNotMatch(markdown,/DO_NOT_EXPORT|private DOM fixture/);
  const json=JSON.parse(serializeDomBatchReport(report,'json',timestamp));
  assert.equal(json.items[0].name,name,'JSON must preserve the raw basename identity');
  assert.equal(json.items[0].verification.V4,'not-configured');
 }
});

test('RG-07 DOM Markdown preserves ordinary Unicode filename and stable grade projections',()=>{
 const name='电影🎬-résumé.user.js';
 const markdown=serializeDomBatchReport(fixture(name),'markdown',timestamp);
 assert.match(markdown,/电影🎬-résumé[.]user[.]js/);
 assert.match(markdown,/passed.*passed.*blocked.*not-configured.*not-configured/);
 assert.equal(markdown.split('\n').filter(line=>line.startsWith('|')).length,3);
 const json=JSON.parse(serializeDomBatchReport(fixture(name),'json',timestamp));
 assert.equal(json.items[0].name,name);
 assert.equal(json.pageOrigin,'https://example.invalid');
});
