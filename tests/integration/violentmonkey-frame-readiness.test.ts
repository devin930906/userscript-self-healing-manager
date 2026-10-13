import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {waitForPinnedFixtureFrame} from '../../scripts/violentmonkey-frame-ready.ts';

const expectedUrl='http://127.0.0.1:49152/fixture';
const verified={targetId:'synthetic-tab',confirmedUrl:expectedUrl,frameId:'root',loaderId:'load-1'};

test('QA official-manager fixture waits for a newly created frame to become ready',async()=>{
 let calls=0,pauses=0;
 const result=await waitForPinnedFixtureFrame({
  expectedUrl,
  inspect:async()=>{
   calls++;
   if(calls===1)throw new Error('Invalid CDP frame tree URL');
   if(calls===2)throw new Error('Invalid main-frame document identity token');
   return verified;
  },
  hasExited:()=>false,
  pause:async()=>{pauses++;},
  maxAttempts:4,
 });
 assert.deepEqual(result,verified);
 assert.equal(calls,3);
 assert.equal(pauses,2);
});

test('QA official-manager fixture has bounded retries and rejects unrelated errors without exposing private text',async()=>{
 let calls=0;
 await assert.rejects(waitForPinnedFixtureFrame({
  expectedUrl,inspect:async()=>{calls++;throw new Error('Invalid CDP frame tree URL');},
  hasExited:()=>false,pause:async()=>{},maxAttempts:3,
 }),/fixture.*(ready|identity)|frame/i);
 assert.equal(calls,3);
 calls=0;
 await assert.rejects(waitForPinnedFixtureFrame({
  expectedUrl,inspect:async()=>{
   calls++;throw new Error('CDP page URL changed or frame identity mismatch: PRIVATE_FIXTURE_TOKEN');
  },
  hasExited:()=>false,pause:async()=>{throw new Error('must not retry identity change');},
  maxAttempts:4,
 }),error=>{
  assert.ok(error instanceof Error);
  assert.doesNotMatch(error.message,/PRIVATE_FIXTURE_TOKEN/);
  return true;
 });
 assert.equal(calls,1,'identity mismatch is never transient');
});

test('QA official-manager fixture refuses Chrome exit, invalid identity and non-loopback scope',async()=>{
 let calls=0;
 await assert.rejects(waitForPinnedFixtureFrame({
  expectedUrl,inspect:async()=>{calls++;return verified;},
  hasExited:()=>true,pause:async()=>{},
 }),/exited|Chrome/i);
 assert.equal(calls,0);
 await assert.rejects(waitForPinnedFixtureFrame({
  expectedUrl,inspect:async()=>({...verified,confirmedUrl:'https://outside.example.invalid/'}),
  hasExited:()=>false,pause:async()=>{throw new Error('must not retry mismatch');},
 }),/identity|fixture/i);
 await assert.rejects(waitForPinnedFixtureFrame({
  expectedUrl:'https://outside.example.invalid/fixture',
  inspect:async()=>verified,hasExited:()=>false,pause:async()=>{},
 }),/loopback|fixture|URL/i);
});

test('official-manager isolated smoke uses a bounded confirmed frame wait, not a single race-prone read',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 assert.match(source,/await waitForPinnedFixtureFrame\s*\(/);
 assert.doesNotMatch(source,/const identity=await confirmPageIdentity\(fixturePage\);/);
});
