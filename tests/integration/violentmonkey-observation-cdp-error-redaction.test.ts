import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readViolentmonkeyFixtureObservation} from '../../scripts/violentmonkey-v4-contract.ts';

const url='http://127.0.0.1:32123/fixture';
const frame=()=>({frameTree:{frame:{id:'fixture-frame',loaderId:'fresh-loader',url}}});
const input=(send:(method:string)=>Promise<any>)=>({
 send,frameId:'fixture-frame',url,previousLoaderId:'old-loader',
 hasExited:()=>false,delay:async()=>{},
});

test('RG-07 isolated GM observation redacts a rejected CDP frame identity error',async()=>{
 let calls=0;
 const raw='PRIVATE_CDP_FRAME_CREDENTIAL https://private.invalid/?token=RAW_SECRET';
 for(const rejection of [new Error(raw),{detail:raw},raw]){
  await assert.rejects(
   readViolentmonkeyFixtureObservation(input(async(method:string)=>{
    calls++;
    assert.equal(method,'Page.getFrameTree');
    throw rejection;
   })),
   (error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Isolated fixture frame inspection failed');
    assert.doesNotMatch(error.message,/PRIVATE_|RAW_SECRET|private[.]invalid|token/);
    assert.equal('cause' in error,false,'never retain a raw CDP error as an exportable cause');
    return true;
   },
  );
 }
 assert.equal(calls,3,'reject a failed frame probe immediately; do not retry raw CDP failures');
});

test('RG-07 isolated GM observation redacts a rejected Runtime.evaluate error',async()=>{
 let calls=0;
 const raw='PRIVATE_CDP_EVALUATION_CREDENTIAL /users/private/secret.user.js';
 for(const rejection of [new Error(raw),{nested:{secret:raw}},raw]){
  await assert.rejects(
   readViolentmonkeyFixtureObservation(input(async(method:string)=>{
    calls++;
    if(method==='Page.getFrameTree')return frame();
    assert.equal(method,'Runtime.evaluate');
    throw rejection;
   })),
   (error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Isolated GM fixture evaluation failed');
    assert.doesNotMatch(error.message,/PRIVATE_|secret[.]user|users\/private/);
    assert.equal('cause' in error,false);
    return true;
   },
  );
 }
 assert.equal(calls,6,'one pinned frame read and one rejected GM evaluation per case');
});

test('RG-07 a healthy pinned loopback receipt is still accepted, without product V4 promotion',async()=>{
 const receipt=JSON.stringify({
  storageBefore:0,storageAfter:1,storageReadback:1,
  menuCommandId:'usshm-v4-fixture-menu',requestStatus:200,
  requestBody:'USSHM_GM_REQUEST_OK',
 });
 const value=await readViolentmonkeyFixtureObservation(input(async(method:string)=>{
  if(method==='Page.getFrameTree')return frame();
  assert.equal(method,'Runtime.evaluate');
  return {result:{value:receipt}};
 }));
 assert.equal(value.requestStatus,200);
 assert.equal(value.storageReadback,1);
});
