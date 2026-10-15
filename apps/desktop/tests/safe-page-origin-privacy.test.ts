import assert from 'node:assert/strict';
import {test} from 'node:test';
import {safeDomReportPageOrigin} from '../src/renderer/safe-page-origin.ts';

test('RG-07 DOM report origin drops private paths, query, fragments and port-preserving credentials rejection',()=>{
 assert.equal(safeDomReportPageOrigin('https://example.invalid:8443/private?token=SECRET#fragment'),'https://example.invalid:8443');
 assert.equal(safeDomReportPageOrigin('https://user:password@example.invalid/private'),'站点来源未确认');
 assert.equal(safeDomReportPageOrigin('file:///C:/Users/SECRET/private.html'),'站点来源未确认');
});

test('RG-07 DOM report origin fails closed on URL parser normalization of whitespace and controls',()=>{
 for(const suffix of [' ', '\\n', '\\r', '\\t', '\\u0000', '\\u007f']){
  const value=suffix===' '? ' https://example.invalid/private?token=SECRET' : 'https://example.invalid/pri'+suffix+'vate?token=SECRET';
  assert.equal(safeDomReportPageOrigin(value),'站点来源未确认',JSON.stringify(value));
 }
 assert.equal(safeDomReportPageOrigin('https://example.invalid/?encoded=%0A%09'),'https://example.invalid');
});
