import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const api=contract as any;
const template='// @name USSHM Isolated Violentmonkey V4 Fixture\n'+
 '// @namespace https://usshm.invalid/isolated-fixture\n'+
 '// @match http://127.0.0.1/*\n// fixed synthetic body sentinel';

test('fixed manager fixture match includes its actual bound loopback port and exact path',()=>{
 assert.equal(typeof api.scopeViolentmonkeyFixtureToUrl,'function');
 for(const url of ['http://127.0.0.1:12345/fixture','http://127.0.0.1:65535/fixture']){
  const source=api.scopeViolentmonkeyFixtureToUrl(template,url);
  assert.equal(source,template.replace('// @match http://127.0.0.1/*','// @match '+url));
  assert.ok(source.endsWith('// fixed synthetic body sentinel'));
  assert.doesNotMatch(source,/127\.0\.0\.1:\*/);
  assert.equal(api.scopeViolentmonkeyFixtureToUrl(template.replace(/\n/g,'\r\n'),url),source.replace(/\n/g,'\r\n'));
 }
});

test('fixed fixture scope rejects non-loopback origins, altered paths, credentials and duplicate metadata anchors',()=>{
 assert.equal(typeof api.scopeViolentmonkeyFixtureToUrl,'function');
 for(const url of ['https://private.example/fixture','http://localhost:12345/fixture',
  'http://127.0.0.1/fixture','http://127.0.0.1:12345/other','http://127.0.0.1:12345/fixture?secret=value',
  'http://user:secret@127.0.0.1:12345/fixture']){
  assert.throws(()=>api.scopeViolentmonkeyFixtureToUrl(template,url),/fixture scope/i);
 }
 assert.throws(()=>api.scopeViolentmonkeyFixtureToUrl(template+'\n// @match http://127.0.0.1/*',
  'http://127.0.0.1:12345/fixture'),/fixture scope/i);
});
