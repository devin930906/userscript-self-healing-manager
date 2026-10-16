import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readViolentmonkeyFixtureObservation} from '../../scripts/violentmonkey-v4-contract.ts';

const url='http://127.0.0.1:32123/fixture';
const frame=()=>({frameTree:{frame:{id:'fixture-frame',loaderId:'fixture-loader',url}}});

/**
 * Only the 73rd evaluation is a stage fallback. All 72 normal GM receipt
 * polls return null, with pinned frame identity before and after each one.
 * Fixed loopback-only data: no actual browser profiles, pages or scripts.
 */
async function stageAfterMissingReceipt(reply:unknown):Promise<Error>{
 let evaluations=0;
 const error=await readViolentmonkeyFixtureObservation({
  frameId:'fixture-frame',url,hasExited:()=>false,delay:async()=>{},
  send:async(method:string)=>{
   if(method==='Page.getFrameTree')return frame();
   assert.equal(method,'Runtime.evaluate');
   return ++evaluations===73?reply:{result:{value:null}};
  },
 }).then(()=>null,(caught:unknown)=>caught);
 assert.ok(error instanceof Error);
 assert.equal(evaluations,73,'72 GM probes and exactly one diagnostic stage query');
 return error;
}

test('RG-05 diagnostic stage refuses inherited and error-bearing CDP responses',async()=>{
 const replies=[
  Object.create({result:{value:'completed'}}),
  {result:Object.create({value:'completed'})},
  {error:false,result:{value:'completed'}},
  {result:{exceptionDetails:null,value:'completed'}},
 ];
 for(const reply of replies){
  const error=await stageAfterMissingReceipt(reply);
  assert.equal(error.message,
   'Pinned Violentmonkey fixture did not publish its bounded GM API result; stage: not-observed');
 }
});

test('RG-07 diagnostic stage must never invoke CDP response accessors',async()=>{
 let getterCalls=0;
 const getter=()=>{getterCalls++;throw Error('PRIVATE_STAGE_GETTER_MUST_NOT_RUN');};
 for(const reply of [
  Object.defineProperty({},'result',{enumerable:true,get:getter}),
  {result:Object.defineProperty({},'value',{enumerable:true,get:getter})},
  Object.defineProperty({result:{value:'completed'}},'error',{get:getter}),
 ]){
  const error=await stageAfterMissingReceipt(reply);
  assert.equal(error.message,
   'Pinned Violentmonkey fixture did not publish its bounded GM API result; stage: not-observed');
 }
 assert.equal(getterCalls,0,'stage inspection must use descriptor-only reads');
});

test('RG-05 valid own-data stage continues to produce a bounded diagnostic only',async()=>{
 const error=await stageAfterMissingReceipt({result:{value:'gm-request'}});
 assert.equal(error.message,
  'Pinned Violentmonkey fixture did not publish its bounded GM API result; stage: gm-request');
});
