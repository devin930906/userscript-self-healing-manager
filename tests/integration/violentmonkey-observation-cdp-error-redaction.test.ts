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

test('RG-05 GM fixture rejects error-bearing Runtime.evaluate envelopes rather than forged positive receipts',async()=>{
 const positive=JSON.stringify({
  storageBefore:0,storageAfter:1,storageReadback:1,
  menuCommandId:'usshm-v4-fixture-menu',requestStatus:200,
  requestBody:'USSHM_GM_REQUEST_OK',
 });
 const secret='PRIVATE_CDP_GM_ERROR https://private.invalid/token';
 const forged=[
  {error:secret,result:{value:positive}},
  {exceptionDetails:false,result:{value:positive}},
  {result:{error:null,value:positive}},
  {result:{exceptionDetails:false,value:positive}},
  Object.assign(Object.create({error:secret}),{result:{value:positive}}),
  {result:Object.assign(Object.create({exceptionDetails:null}),{value:positive})},
 ];
 for(const reply of forged){
  let evaluations=0;
  await assert.rejects(readViolentmonkeyFixtureObservation(input(async(method:string)=>{
   if(method==='Page.getFrameTree')return frame();
   evaluations++;
   return reply;
  })),(error:unknown)=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Isolated GM fixture evaluation failed');
   assert.doesNotMatch(error.message,/PRIVATE_|private[.]invalid/);
   assert.equal('cause' in error,false);
   return true;
  });
  assert.equal(evaluations,1,'invalid protocol envelope must fail without retry');
 }
});

test('RG-05 GM fixture evaluation rejects accessors without calling them or leaking their contents',async()=>{
 const privateToken='PRIVATE_CDP_GM_GETTER https://private.invalid/token';
 let invoked=0;
 const getter=()=>{invoked++;throw new Error(privateToken);};
 const forged=[
  Object.defineProperty({},'result',{enumerable:true,get:getter}),
  {result:Object.defineProperty({},'value',{enumerable:true,get:getter})},
  Object.defineProperty({result:{value:null}},'exceptionDetails',{enumerable:true,get:getter}),
  Object.defineProperty({result:{value:null}},'error',{enumerable:true,get:getter}),
 ];
 for(const reply of forged){
  await assert.rejects(readViolentmonkeyFixtureObservation(input(async(method:string)=>
   method==='Page.getFrameTree'?frame():reply)),(error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Isolated GM fixture evaluation failed');
    assert.equal('cause' in error,false);
    assert.doesNotMatch(error.message,/PRIVATE_|private[.]invalid/);
    return true;
   });
 }
 assert.equal(invoked,0);
});

test('RG-05 pinned frame identity rejects CDP faults even with matching forged frame data',async()=>{
 const privateToken='PRIVATE_CDP_FRAME_FAULT https://private.invalid/credential';
 const matched=frame().frameTree;
 const replies=[
  {error:privateToken,frameTree:matched},
  {exceptionDetails:null,frameTree:matched},
  {frameTree:{error:privateToken,frame:matched.frame}},
  {frameTree:{exceptionDetails:false,frame:matched.frame}},
  Object.assign(Object.create({error:privateToken}),{frameTree:matched}),
  {frameTree:Object.assign(Object.create({exceptionDetails:false}),{frame:matched.frame})},
 ];
 for(const reply of replies){
  let frameReads=0,evals=0;
  await assert.rejects(readViolentmonkeyFixtureObservation(input(async(method:string)=>{
   if(method==='Page.getFrameTree'){frameReads++;return reply;}
   evals++;return {result:{value:null}};
  })),(error:unknown)=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Isolated fixture frame inspection failed');
   assert.doesNotMatch(error.message,/PRIVATE_|private[.]invalid/);
   assert.equal('cause' in error,false);
   return true;
  });
  assert.equal(frameReads,1,'invalid frame protocol data must fail immediately');
  assert.equal(evals,0,'never evaluate on an untrusted document identity');
 }
});

test('RG-05 pinned frame identity rejects accessors without running getters or leaking errors',async()=>{
 const privateToken='PRIVATE_CDP_FRAME_GETTER https://private.invalid/credential';
 let getters=0;
 const getter=()=>{getters++;throw new Error(privateToken);};
 const matched=frame().frameTree;
 const replies=[
  Object.defineProperty({},'frameTree',{enumerable:true,get:getter}),
  {frameTree:Object.defineProperty({},'frame',{enumerable:true,get:getter})},
  {frameTree:{frame:Object.defineProperty({...matched.frame},'id',{enumerable:true,get:getter})}},
  {frameTree:{frame:Object.defineProperty({...matched.frame},'loaderId',{enumerable:true,get:getter})}},
  Object.defineProperty({frameTree:matched},'error',{enumerable:true,get:getter}),
 ];
 for(const reply of replies){
  let evals=0;
  await assert.rejects(readViolentmonkeyFixtureObservation(input(async(method:string)=>{
   if(method==='Page.getFrameTree')return reply;
   evals++;return {result:{value:null}};
  })),(error:unknown)=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Isolated fixture frame inspection failed');
   assert.doesNotMatch(error.message,/PRIVATE_|private[.]invalid/);
   assert.equal('cause' in error,false);
   return true;
  });
  assert.equal(evals,0);
 }
 assert.equal(getters,0);
});
