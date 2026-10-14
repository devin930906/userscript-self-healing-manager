import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const fixtureUrl='http://127.0.0.1:49152/fixture';

async function runMatcher(receipt:unknown){
 const builder=(contract as Record<string,unknown>).buildViolentmonkeyFixtureMatchExpression;
 assert.equal(typeof builder,'function','missing official-manager URL matcher evidence');
 const expression=(builder as (url:string,id:number)=>string)(fixtureUrl,7);
 const listeners=new Set<(e:any)=>void>(),sent:any[]=[];
 const context=vm.createContext({navigator:{serviceWorker:{
  controller:null,ready:Promise.resolve({active:{postMessage(message:any){
   sent.push(message);
   queueMicrotask(()=>{for(const cb of listeners)cb({data:{id:message.id,res:receipt}});});
  }}}),
  addEventListener(_kind:string,cb:(e:any)=>void){listeners.add(cb);},
  removeEventListener(_kind:string,cb:(e:any)=>void){listeners.delete(cb);},
 }},JSON,Promise,setTimeout,clearTimeout});
 const raw=await vm.runInContext(expression,context);
 assert.equal(sent.length,1);
 assert.equal(sent[0].msg.cmd,'GetMoreIds','use official non-executing match engine');
 assert.deepEqual(JSON.parse(JSON.stringify(sent[0].msg.data)),{
  url:fixtureUrl,top:1,ids:{},
 });
 return JSON.parse(raw);
}

test('RG-05 official manager matcher checks exact installed fixture ID without exporting other scripts',async()=>{
 assert.deepEqual(await runMatcher({'7':'more'}),{matched:true});
 for(const payload of [{},{'8':'more'},{'7':'more','8':'more'},null]){
  assert.deepEqual(await runMatcher(payload),{matched:false});
 }
 const builder=(contract as Record<string,unknown>).buildViolentmonkeyFixtureMatchExpression as
  (url:string,id:number)=>string;
 assert.throws(()=>builder('https://account.example/fixture',7),/fixture|scope|loopback|URL/i);
 assert.throws(()=>builder(fixtureUrl,0),/identity|script|id/i);
});

test('RG-05 isolated official manager actual URL matching is checked before first injection and after restart',async()=>{
 const src=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const calls=[...src.matchAll(/readManagerFixtureMatch\(optionsCdp/g)].map(m=>m.index);
 assert.equal(calls.length,2,'both real Chrome epochs must check official matching');
 assert.ok(calls[0]!<src.indexOf("RG-05 fixed stage: first-document"));
 assert.ok(calls[1]!<src.indexOf("const createdRestartFixture=await browserCdp.send"));
 assert.match(src,/RG-05 official manager fixture matcher/);
 assert.doesNotMatch(src,/console\.log\([^\n]*GetMoreIds/);
});
