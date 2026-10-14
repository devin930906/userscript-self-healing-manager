import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as boundary from '../src/synthetic-action-boundary.ts';

const url='http://127.0.0.1:43219/fixture';
const target={type:'page',id:'fixture-one',url,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fixture-one'};
const check=(boundary as {assessSyntheticActionBoundary?:(input:unknown)=>unknown}).assessSyntheticActionBoundary;
const request=(values:Record<string,unknown>={})=>({
 approved:true,action:'fixture-test-click',target,fixtureUrl:url,elementId:'fixture-safe-click',...values,
});

test('FR-025 permitted synthetic click scope never issues a transferable real-page V2 grant',()=>{
 assert.equal(typeof check,'function','missing production-safe action classification boundary');
 const verdict=check!(request()) as any;
 assert.equal(verdict.status,'fixture-eligible');
 assert.equal(verdict.productionEligible,false);
 assert.equal(verdict.V2,'blocked');
 assert.equal(verdict.V3,'not-configured');
 assert.equal(verdict.V4,'not-configured');
 assert.equal(verdict.interactionVerified,false);
 assert.equal(verdict.functionalVerified,false);
 assert.equal('execute' in verdict,false);
 assert.equal('token' in verdict,false);
});

test('FR-025 real pages cannot be authorized by claiming their button is harmless',()=>{
 assert.equal(typeof check,'function');
 for(const origin of ['https://chatgpt.com/c/test','https://account.example/pay',
  'http://localhost:43219/fixture','http://127.0.0.1:43219/private',
  'http://127.0.0.1:43219/fixture?next=send','http://127.0.0.1:43219/./fixture',
  'http://user:pass@127.0.0.1:43219/fixture']){
  assert.throws(()=>check!(request({fixtureUrl:origin,target:{...target,url:origin}})),/fixture|noncanonical|local|loopback|URL/i,origin);
 }
});

test('FR-025 nonclick, dangerous, arbitrary, or unapproved actions fail before any CDP operation',()=>{
 assert.equal(typeof check,'function');
 for(const risk of ['send','delete','pay','submit','navigate','fixture-test-click-extra']){
  assert.throws(()=>check!(request({action:risk})),/action|fixture|refus/i);
 }
 for(const mutation of [
  {approved:false},{elementId:'send-button'},{elementId:'#fixture-safe-click'},
  {target:{...target,type:'browser'}},
  {target:{...target,id:'other'}},
  {target:{...target,webSocketDebuggerUrl:'ws://example.org:9223/devtools/page/fixture-one'}},
  {target:{...target,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/other'}},
 ]){
  assert.throws(()=>check!(request(mutation)),/approval|button|target|CDP|loopback|scope|identity/i);
 }
});

test('FR-025 test-only click executor must independently run the action boundary before opening CDP',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync('scripts/local-fixture-interaction.ts','utf8');
 assert.match(source,/assessSyntheticActionBoundary\(/);
 const preflight=source.indexOf('assessSyntheticActionBoundary(');
 const socket=source.indexOf('const socket=');
 assert.ok(preflight>=0&&socket>preflight,'preflight must precede creation of browser connection');
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 assert.doesNotMatch(main,/runIsolatedFixtureInteraction|local-fixture-interaction/,
  'test-only click executor must not be available in production Main');
});
