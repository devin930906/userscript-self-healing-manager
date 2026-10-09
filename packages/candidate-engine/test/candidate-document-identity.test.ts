import assert from 'node:assert/strict';
import {test} from 'node:test';
import {suggestCandidateRepairs} from '../src/workflow.ts';

const target={id:'live-candidate-page',url:'https://fixture.example.test/edit'};
const locator={method:'querySelector',expression:'#old-action',runtimeRequired:false};
const snapshot={targetId:target.id,url:target.url,scope:'top-document',
 nodes:[{tagName:'BUTTON',attributes:{'data-testid':'action'}}]};
const matched=(entries:readonly typeof locator[])=>({targetId:target.id,url:target.url,
 checks:entries.map(e=>({method:e.method,expression:e.expression,
 status:e.expression==='#old-action'?'missing':'found',
 matchCount:e.expression==='#old-action'?0:1}))});

test('candidate suggestions refuse same-URL main-frame navigation between original probe and captured DOM',async()=>{
 let identities=0,probes=0;
 await assert.rejects(suggestCandidateRepairs({
  target,locator,deps:{
   confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'frame',
     loaderId:++identities>=3?'new-document':'original-document'}),
   probe:async entries=>{probes++;return matched(entries);},
   capture:async()=>snapshot,
  },
 }),/document|identity|loader|navigation|reload/i);
 assert.equal(probes,1,'navigation must block before candidate confirmation');
});

test('unverified or mismatched main Frame/Loader tokens cannot certify candidates',async()=>{
 for(const token of [
  {targetId:target.id,confirmedUrl:target.url,frameId:'',loaderId:'loader'},
  {targetId:target.id,confirmedUrl:target.url,frameId:'frame',loaderId:''},
  {targetId:target.id,confirmedUrl:'https://other.example.test/',frameId:'frame',loaderId:'loader'},
 ]){
  await assert.rejects(suggestCandidateRepairs({
   target,locator,deps:{confirm:async()=>token,
    probe:async entries=>matched(entries),capture:async()=>snapshot},
  }),/document|identity|frame|loader/i);
 }
});

test('stable live Frame and Loader across all stages retain read-only candidate suggestion',async()=>{
 let checks=0;
 const candidates=await suggestCandidateRepairs({target,locator,deps:{
  confirm:async()=>{checks++;return {targetId:target.id,confirmedUrl:target.url,frameId:'frame',loaderId:'loader'};},
  probe:async entries=>matched(entries),capture:async()=>snapshot,
 }});
 assert.ok(checks>=3);
 assert.deepEqual(candidates.map(c=>c.expression),['[data-testid="action"]']);
 assert.equal(candidates[0]?.approved,false);
});
