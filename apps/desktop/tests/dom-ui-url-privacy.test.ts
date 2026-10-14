import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {safeDomReportPageOrigin} from '../src/renderer/safe-page-origin.ts';

const canaries=['PRIVATE_QUERY_TOKEN','PRIVATE_FRAGMENT_TOKEN','PRIVATE_LOGIN_NAME','PRIVATE_PASSWORD'];
test('RG-07 desktop DOM diagnosis renders only the website origin, not a private page URL',async()=>{
 const value=safeDomReportPageOrigin('https://example.invalid:8443/my/private/path?session=PRIVATE_QUERY_TOKEN#PRIVATE_FRAGMENT_TOKEN');
 assert.equal(value,'https://example.invalid:8443');
 for(const marker of canaries)assert.equal(value.includes(marker),false);
 const src=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(src,/safeDomReportPageOrigin\(batchResult\.pageUrl\)/);
 assert.doesNotMatch(src,/\{batchResult\.pageUrl\}/,
  'The displayed DOM batch notice must never interpolate a full URL containing query credentials');
});
test('RG-07 product page-origin projection rejects credentialed or untrusted target URLs',()=>{
 for(const unsafe of [
  'https://PRIVATE_LOGIN_NAME:PRIVATE_PASSWORD@example.invalid/account',
  'https://PRIVATE_LOGIN_NAME@example.invalid/account',
  'javascript:alert(PRIVATE_QUERY_TOKEN)',
  'file:///C:/PRIVATE_QUERY_TOKEN/secret.txt',
  'http://example.invalid/no-network-credentials',
  null,undefined,{},42,'not-a-url','https://example.invalid/'+ 'x'.repeat(4097),
 ]){
  const projected=safeDomReportPageOrigin(unsafe);
  if(unsafe==='http://example.invalid/no-network-credentials'){
   assert.equal(projected,'http://example.invalid');
  }else{
   assert.equal(projected,'站点来源未确认');
  }
  for(const marker of canaries)assert.equal(projected.includes(marker),false);
 }
});
test('RG-07 origin projection stays useful for Unicode domains, localhost and ordinary HTTPS pages',()=>{
 assert.equal(safeDomReportPageOrigin('http://127.0.0.1:49152/fixture?secret=PRIVATE_QUERY_TOKEN'),'http://127.0.0.1:49152');
 assert.equal(safeDomReportPageOrigin('https://example.invalid/app'),'https://example.invalid');
 assert.equal(safeDomReportPageOrigin('https://example.invalid/'),'https://example.invalid');
});
