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
