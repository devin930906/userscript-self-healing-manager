import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readViolentmonkeyFixtureObservation} from '../../scripts/violentmonkey-v4-contract.ts';

const fixtureUrl='http://127.0.0.1:32123/fixture';
const pinnedFrame=()=>({frameTree:{frame:{id:'frame',loaderId:'loader-pinned',url:fixtureUrl}}});
const navigatedFrame=()=>({frameTree:{frame:{id:'frame',loaderId:'loader-other',
 url:'http://127.0.0.1:32123/unrelated'}}});
const input=(send:(method:string)=>Promise<any>,hasExited=()=>false,delay=async()=>{})=>({
 send,frameId:'frame',url:fixtureUrl,hasExited,delay,
});

test('RG-05 timeout-stage fallback must not inspect DOM after navigating away from pinned loopback page',async()=>{
 let frames=0,evaluations=0;
 await assert.rejects(readViolentmonkeyFixtureObservation(input(async method=>{
  if(method==='Page.getFrameTree')return ++frames<=72?pinnedFrame():navigatedFrame();
  if(method==='Runtime.evaluate'){
   evaluations++;
   return {result:{value:null}};
  }
  throw new Error('unexpected protocol call');
 })),/Isolated fixture document identity changed/);
 assert.equal(frames,73,'72 bounded GM polls followed by a mandatory pinned frame check');
 assert.equal(evaluations,72,'stage fallback must never inspect an unverified new page');
});

test('RG-05 diagnostic stage must be discarded when page navigates during fallback evaluation',async()=>{
 let frames=0,evaluations=0;
 await assert.rejects(readViolentmonkeyFixtureObservation(input(async method=>{
  if(method==='Page.getFrameTree')return ++frames<=73?pinnedFrame():navigatedFrame();
  if(method==='Runtime.evaluate'){
   evaluations++;
   return {result:{value:evaluations===73?'menu-registration':null}};
  }
  throw new Error('unexpected protocol call');
 })),/Isolated fixture document identity changed/);
 assert.equal(frames,74,'compare document identity before and after the final stage read');
 assert.equal(evaluations,73,'bounded GM polls plus one diagnostic read');
});

test('RG-05 fixture must abort after browser exit rather than inspect the timeout-stage DOM',async()=>{
 let exited=false,evaluations=0;
 await assert.rejects(readViolentmonkeyFixtureObservation(input(async method=>{
  if(method==='Page.getFrameTree')return pinnedFrame();
  if(method==='Runtime.evaluate'){evaluations++;return {result:{value:null}};}
  throw new Error('unexpected protocol call');
 },()=>exited,async()=>{if(evaluations===72)exited=true;})),/exited during GM fixture observation/);
 assert.equal(evaluations,72,'never read a diagnostic attribute after the browser closes');
});
