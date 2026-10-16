import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertCredentialFreePageUrl} from '../src/page-url-safety.ts';

const prefix='https://fixture.example.invalid/?q=';

test('RG-07 CDP page URL is bounded before parsing and keeps valid encoded queries',()=>{
 assert.doesNotThrow(()=>assertCredentialFreePageUrl(prefix+'x'.repeat(8192-prefix.length)));
 assert.doesNotThrow(()=>assertCredentialFreePageUrl(
  'https://fixture.example.invalid/editor?encoded=%0A%09&view=review'));
 for(const input of [prefix+'x'.repeat(8193-prefix.length),prefix+'x'.repeat(200_000)]){
  assert.throws(()=>assertCredentialFreePageUrl(input),/invalid|credential/i);
 }
});

test('RG-07 CDP page URL rejects parser-normalized whitespace and raw controls',()=>{
 const base='https://fixture.example.invalid/editor?view=review';
 for(const input of [
  ' '+base,base+' ',base+'\n',base+'\r',base+'\t',
  'https://fixture.example.invalid/ed\nitor?view=review',
  'https://fixture.example.invalid/ed\titor?view=review',
  'https://fixture.example.invalid/ed\ritor?view=review',
  'https://fixture.example.invalid/ed\u0000itor?view=review',
 ]){
  assert.throws(()=>assertCredentialFreePageUrl(input),/invalid|credential/i);
 }
});

test('RG-07 CDP page URL rejects raw C1 controls before WHATWG normalization',()=>{
 const base='https://fixture.example.invalid/editor?view=review';
 for(const control of ['\\u0080','\\u0085','\\u009f']){
  const raw=JSON.parse('"'+control+'"') as string;
  for(const input of [
   'https://fixture.example.invalid/edit'+raw+'or?view=review',
   base+'&label='+raw+'hidden',
  ]){
   assert.throws(()=>assertCredentialFreePageUrl(input),/invalid|credential/i,
    'raw C1 controls must not be accepted as selected CDP page identities');
  }
 }
 // Encoded data are legitimate literal URL bytes, not raw control characters.
 assert.doesNotThrow(()=>assertCredentialFreePageUrl(
  'https://fixture.example.invalid/editor?label=%C2%85&view=review'));
 assert.doesNotThrow(()=>assertCredentialFreePageUrl(
  'https://fixture.example.invalid/%E6%B5%8B%E8%AF%95?view=review'));
});
