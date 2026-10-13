import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const api=contract as any;
const url='http://127.0.0.1:32123/fixture';
const fixture=JSON.stringify({storageBefore:1,storageAfter:2,storageReadback:2,
 menuCommandId:'usshm-v4-fixture-menu',requestStatus:200,requestBody:'USSHM_GM_REQUEST_OK'});
const frame=(loaderId='new-loader',pageUrl=url)=>({frameTree:{frame:{id:'frame',loaderId,url:pageUrl}}});
const input=(send:any)=>({send,frameId:'frame',url,previousLoaderId:'old-loader',
 hasExited:()=>false,delay:async()=>{}});

test('reloaded GM evidence waits for a fresh loader and never accepts the previous document attribute',async()=>{
 assert.equal(typeof api.readViolentmonkeyFixtureObservation,'function');
 const methods:string[]=[];
 let frames=0;
 const result=await api.readViolentmonkeyFixtureObservation(input(async(method:string)=>{
  methods.push(method);
  if(method==='Page.getFrameTree')return frame(++frames===1?'old-loader':'new-loader');
  return {result:{value:fixture}};
 }));
 assert.equal(result.storageBefore,1);
 assert.deepEqual(methods,['Page.getFrameTree','Page.getFrameTree','Runtime.evaluate','Page.getFrameTree']);
});

test('GM fixture evidence is rejected when its frame, page or loader changes during observation',async()=>{
 assert.equal(typeof api.readViolentmonkeyFixtureObservation,'function');
 for(const changed of [frame('third-loader'),frame('new-loader','http://127.0.0.1:32123/other'),
  {frameTree:{frame:{id:'other-frame',loaderId:'new-loader',url}}}]){
  let frames=0;
  await assert.rejects(()=>api.readViolentmonkeyFixtureObservation(input(async(method:string)=>{
   if(method==='Page.getFrameTree')return ++frames===1?frame():changed;
   return {result:{value:fixture}};
  })),/document identity/i);
 }
});

test('fixture observation rejects foreign origins, oversized receipts and browser exceptions without returning raw details',async()=>{
 assert.equal(typeof api.readViolentmonkeyFixtureObservation,'function');
 let calls=0;
 await assert.rejects(()=>api.readViolentmonkeyFixtureObservation({...input(async()=>{calls++;}),
  url:'https://private.example/fixture'}),/fixture identity/i);
 assert.equal(calls,0);
 for(const value of ['x'.repeat(1025),'{private invalid receipt']){
  await assert.rejects(()=>api.readViolentmonkeyFixtureObservation(input(async(method:string)=>
   method==='Page.getFrameTree'?frame():{result:{value}})),/receipt/i);
 }
 await assert.rejects(()=>api.readViolentmonkeyFixtureObservation(input(async(method:string)=>
  method==='Page.getFrameTree'?frame():{exceptionDetails:{text:'private browser error'}})),
  /fixture evaluation failed/i);
});

test('a never-reloaded document has a finite observation budget and produces no GM pass',async()=>{
 assert.equal(typeof api.readViolentmonkeyFixtureObservation,'function');
 let reads=0;
 await assert.rejects(()=>api.readViolentmonkeyFixtureObservation(input(async(method:string)=>{
  assert.equal(method,'Page.getFrameTree');reads++;return frame('old-loader');
 })),/did not publish/i);
 assert.equal(reads,72);
});
