import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkUserscriptPageScope} from '../src/page-scope.ts';

const meta={
 match:['https://example.org/private'],
 include:[],
 raw:{},
};

test('RG-01 denies scope when URL parsing would silently strip raw ASCII controls or surrounding whitespace',()=>{
 // new URL() removes embedded CR/LF/TAB and surrounding whitespace. Those
 // noncanonical untrusted CDP/IPC values cannot be silently authorized as
 // though they were the exact selected page identity.
 for(const value of [
  ' https://example.org/private',
  'https://example.org/private ',
  'https://example.org/\nprivate',
  'https://example.org/\rprivate',
  'https://example.org/\tprivate',
  'https://example.org/private\u0000',
 ]){
  const result=checkUserscriptPageScope(meta,value);
  assert.equal(result.status,'blocked','noncanonical URL must not authorize page scope: '+JSON.stringify(value));
 }
 assert.equal(checkUserscriptPageScope(meta,'https://example.org/private').status,'allowed');
});

test('RG-01 preserves percent-encoded path semantics without treating literal encoded text as a raw control',()=>{
 const encoded={
  match:['https://example.org/%0Aprivate'],
  include:[],
  raw:{},
 };
 assert.equal(checkUserscriptPageScope(encoded,'https://example.org/%0Aprivate').status,'allowed');
});
