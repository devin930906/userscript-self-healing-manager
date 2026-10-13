import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readViolentmonkeyFixtureObservation} from '../../scripts/violentmonkey-v4-contract.ts';

const url='http://127.0.0.1:32123/fixture';
const frame=()=>({frameTree:{frame:{id:'frame',loaderId:'fresh-loader',url}}});
const receipt=JSON.stringify({
 storageBefore:0,storageAfter:1,storageReadback:1,
 menuCommandId:'usshm-v4-fixture-menu',requestStatus:200,requestBody:'USSHM_GM_REQUEST_OK',
});

// This is a test-only browser fixture, not a real account/website. A CDP
// read that completes while CFT exits must never certify GM evidence.
test('RG-05 successful GM receipt cannot survive CFT exit during its final identity fence',async()=>{
 for(const exitAt of ['result-read','final-frame-read'] as const){
  let exited=false;
  let frameReads=0,receipts=0;
  const send=async(method:string)=>{
   if(method==='Page.getFrameTree'){
    frameReads++;
    if(exitAt==='final-frame-read'&&frameReads===2)exited=true;
    return frame();
   }
   assert.equal(method,'Runtime.evaluate');
   receipts++;
   if(exitAt==='result-read')exited=true;
   return {result:{value:receipt}};
  };
  await assert.rejects(
   readViolentmonkeyFixtureObservation({
    send,frameId:'frame',url,previousLoaderId:'old-loader',
    hasExited:()=>exited,delay:async()=>{},
   }),
   /Isolated CFT exited during GM fixture observation/,
   'GM evidence must be invalidated after '+exitAt+' even if stale CDP replies look valid',
  );
  assert.equal(receipts,1,'never request another GM receipt after the browser has exited');
  assert.equal(frameReads,2,'check the pinned document before and after reading the receipt');
 }
});

test('RG-05 live pinned browser still accepts one valid isolated receipt without V4 promotion',async()=>{
 let frames=0,reads=0;
 const result=await readViolentmonkeyFixtureObservation({
  send:async(method:string)=>{
   if(method==='Page.getFrameTree'){frames++;return frame();}
   assert.equal(method,'Runtime.evaluate');
   reads++;
   return {result:{value:receipt}};
  },
  frameId:'frame',url,previousLoaderId:'old-loader',
  hasExited:()=>false,delay:async()=>{},
 });
 assert.equal(result.requestBody,'USSHM_GM_REQUEST_OK');
 assert.equal(frames,2);
 assert.equal(reads,1);
});
