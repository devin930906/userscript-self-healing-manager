import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
 buildViolentmonkeyInjectorProbeExpression,buildViolentmonkeyInjectorReadyExpression,
 waitForVerifiedViolentmonkeyInjector,
} from '../../scripts/violentmonkey-v4-contract.ts';

const exactReady=JSON.stringify({ready:true});
const notReady=JSON.stringify({ready:false});

test('RG-05 delayed real-manager injector is accepted only after BOTH exact receipts within a finite window',async()=>{
 let officialCalls=0,baseCalls=0,delays=0;
 const stages:string[]=[];
 await waitForVerifiedViolentmonkeyInjector({
  hasExited:()=>false,
  send:async(method,params)=>{
   assert.equal(method,'Runtime.evaluate');
   assert.equal(params.awaitPromise,true);
   assert.equal(params.returnByValue,true);
   if(params.expression===buildViolentmonkeyInjectorReadyExpression()){
    officialCalls++;
    return {result:{value:officialCalls<12?notReady:exactReady}};
   }
   assert.equal(params.expression,buildViolentmonkeyInjectorProbeExpression());
   baseCalls++;
   return {result:{value:baseCalls===1?notReady:exactReady}};
  },
  delay:async milliseconds=>{
   assert.ok(milliseconds>=250&&milliseconds<=1000);
   delays++;
  },
  onStatus:stage=>stages.push(stage),
 });
 assert.equal(officialCalls,13,'a late official MV3 readiness event is checked, not guessed');
 assert.equal(baseCalls,2,'a verified worker reply alone cannot certify base registration');
 assert.equal(delays,12,'readiness remains a bounded polling process');
 assert.deepEqual(stages,[
  ...Array<string>(11).fill('official-injector-error'),
  'base-injector-unregistered','ready',
 ]);
});

test('RG-05 extended readiness window still fails closed for never-ready official worker',async()=>{
 let calls=0,sleeps=0;
 const error=await waitForVerifiedViolentmonkeyInjector({
  hasExited:()=>false,
  send:async()=>{calls++;return {result:{value:notReady}};},
  delay:async()=>{sleeps++;},
 }).catch(e=>e);
 assert.ok(error instanceof Error);
 assert.match(error.message,/official injector readiness/i);
 assert.equal(calls,16,'strict final budget must be finite');
 assert.equal(sleeps,15,'never sleep or retry beyond final bounded attempt');
});
