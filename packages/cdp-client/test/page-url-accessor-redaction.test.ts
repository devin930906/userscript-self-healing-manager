import assert from 'node:assert/strict';
import {test} from 'node:test';
import {confirmPageIdentity} from '../src/page-identity.ts';

const safeTarget={type:'page',id:'alpha',url:'https://example.test/',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/alpha'};

test('frame identity redacts throwing page URL accessor and never opens a socket',async()=>{
 const target={...safeTarget};
 Object.defineProperty(target,'url',{get(){throw new Error('private-page-access-token');}});
 let opened=false;
 await assert.rejects(confirmPageIdentity(target,{socketFactory:()=>{opened=true;throw new Error('unexpected socket');}}),error=>{
  assert.ok(error instanceof Error);
  assert.equal(error.message,'Invalid expected page URL');
  return true;
 });
 assert.equal(opened,false);
});

test('frame identity rejects missing or non-string expected page URLs before socket creation',async()=>{
 for(const url of [undefined,null,42,{},'',Symbol('secret')]){
  let opened=false;
  await assert.rejects(confirmPageIdentity({...safeTarget,url} as typeof safeTarget,{socketFactory:()=>{opened=true;throw new Error('unexpected socket');}}),/Invalid expected page URL/);
  assert.equal(opened,false);
 }
});
