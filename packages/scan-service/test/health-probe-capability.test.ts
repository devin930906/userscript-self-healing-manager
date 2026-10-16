import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeLiveLocatorCheck} from '../src/health.ts';

test('RG-01 does not count unsupported selector methods as V1 DOM evidence',()=>{
 for(const method of ['getElementsByTagName','closest','matches','Runtime.evaluate','unknown']){
  const positive=summarizeLiveLocatorCheck([{status:'found',matchCount:1,method}]);
  assert.equal(positive.status,'needs-review',method);
  assert.equal(positive.found,0,method);
  assert.equal(positive.needsReview,1,method);
  const negative=summarizeLiveLocatorCheck([{status:'missing',matchCount:0,method}]);
  assert.equal(negative.status,'needs-review',method);
  assert.equal(negative.missing,0,method);
 }
});

test('RG-01 preserves supported CDP probe method cardinalities and legacy method-free summaries',()=>{
 for(const method of ['querySelector','querySelectorAll','getElementById','getElementsByClassName','getElementsByName']){
  assert.equal(summarizeLiveLocatorCheck([{status:'found',matchCount:1,method}]).status,'dom-present',method);
  assert.equal(summarizeLiveLocatorCheck([{status:'missing',matchCount:0,method}]).status,'locator-missing',method);
 }
 for(const method of ['querySelectorAll','getElementsByClassName','getElementsByName'])
  assert.equal(summarizeLiveLocatorCheck([{status:'found',matchCount:2,method}]).status,'dom-present',method);
 assert.equal(summarizeLiveLocatorCheck([{status:'found',matchCount:2,method:'querySelector'}]).status,'needs-review');
 assert.equal(summarizeLiveLocatorCheck([{status:'found',matchCount:1}]).status,'dom-present');
 assert.equal(summarizeLiveLocatorCheck([{status:'missing',matchCount:0}]).status,'locator-missing');
});

test('RG-01 rejects accessor-backed or inherited method evidence without running getters',()=>{
 let getterCalls=0;
 const accessor={status:'found',matchCount:1};
 Object.defineProperty(accessor,'method',{enumerable:true,get(){getterCalls++;throw new Error('PRIVATE_SELECTOR');}});
 const inherited=Object.create({method:'querySelector'});
 inherited.status='found';inherited.matchCount=1;
 for(const row of [accessor,inherited]){
  const result=summarizeLiveLocatorCheck([row]);
  assert.equal(result.status,'needs-review');
  assert.equal(result.found,0);
 }
 assert.equal(getterCalls,0);
});

test('RG-01 rejects accessor-backed status/count receipts instead of crediting fabricated matches',()=>{
 let getterCalls=0;
 for(const field of ['status','matchCount']){
  const row:any={status:'found',matchCount:1,method:'querySelector'};
  Object.defineProperty(row,field,{get(){getterCalls++;throw new Error('PRIVATE_CDP');}});
  const result=summarizeLiveLocatorCheck([row]);
  assert.equal(result.status,'needs-review');
  assert.equal(result.found,0);
 }
 assert.equal(getterCalls,0);
});
