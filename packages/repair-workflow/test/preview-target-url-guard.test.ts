import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolve} from 'node:path';
import {prepareVerifiedRepairPreview} from '../src/verified-preview.ts';

const sourceHash='a'.repeat(64);
function buildInput(url:string){
 let confirms=0,discoveries=0,proposals=0;
 const input={
  approved:true,
  target:{id:'fixture-target',url},
  locator:{method:'querySelector',expression:'#oldElement',runtimeRequired:false},
  source:{
   scriptId:'fixture-script',sourcePath:resolve('fixture.user.js'),
   expectedSha256:sourceHash,
   selectorLocation:{method:'querySelector',line:1,column:1},
  },
  deps:{
   confirm:async()=>{
    confirms++;
    return {targetId:'fixture-target',confirmedUrl:url,frameId:'frame-1',loaderId:'loader-1'};
   },
   discover:async()=>{discoveries++;return [];},
   verifySource:async()=>{},
   propose:async()=>{proposals++;throw new Error('must not create a proposal');},
   revoke:()=>{},
  },
 };
 return {input,counts:()=>({confirms,discoveries,proposals})};
}

test('RG-01 rejects credential-bearing or invalid preview target URLs before contacting CDP',async()=>{
 for(const url of [
  'https://operator:secret@example.test/editor',
  'https://operator@example.test/editor',
  'http://operator:secret@127.0.0.1:9223/fixture',
  'https://example.test/editor ',
  'https://example.test/editor\nprivate',
  'https://',
  'https://example.test:broken/editor',
 ]){
  const {input,counts}=buildInput(url);
  await assert.rejects(prepareVerifiedRepairPreview(input),
   /Invalid selected CDP target|credential-bearing HTTP\(S\) page URL/,
   'untrusted selected URL must be rejected by Main before opening a page observation');
  assert.deepEqual(counts(),{confirms:0,discoveries:0,proposals:0});
 }
});

test('RG-01 accepts an ordinary credential-free page target without a proposal or browser write',async()=>{
 const {input,counts}=buildInput('https://example.test/editor');
 const result=await prepareVerifiedRepairPreview(input);
 assert.equal(result.status,'needs-review');
 assert.equal(result.proposal,null);
 assert.deepEqual(counts(),{confirms:2,discoveries:1,proposals:0});
});

test('RG-01 rejects malformed target IDs before any repair-preview CDP observation',async()=>{
 for(const id of [
  ' ', 'bad/page', 'target?private', 'target\\nchild'.replace('\\n','\n'),
  'target.with.dots',
 ]){
  const {input,counts}=buildInput('https://example.test/editor');
  input.target.id=id;
  await assert.rejects(prepareVerifiedRepairPreview(input),/Invalid selected CDP target/,
   'a selected target identity must be a bounded Chrome target ID, not free-form page data');
  assert.deepEqual(counts(),{confirms:0,discoveries:0,proposals:0});
 }
});
