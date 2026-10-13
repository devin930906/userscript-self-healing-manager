import assert from 'node:assert/strict';
import {test} from 'node:test';
import {confirmPageIdentity} from '../src/page-identity.ts';

const target={
 type:'page',id:'synthetic-page',
 url:'https://fixture.example.invalid/editor',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/synthetic-page',
};

test('RG-07 frame identity rejects credential-bearing or over-budget target URLs before any CDP socket',async()=>{
 const privateUrls=[
  'https://fixture-user:SECRET_CANARY@fixture.example.invalid/editor',
  'https://fixture-user@fixture.example.invalid/editor',
  'https://fixture.example.invalid/editor?query='+('a'.repeat(8200)),
 ];
 for(const url of privateUrls){
  let sockets=0;
  await assert.rejects(
   confirmPageIdentity({...target,url},{socketFactory:()=>{
    sockets++;
    throw new Error('CDP socket must not open for unsafe target URL');
   }}),
   /invalid|credential|userinfo|page URL/i,
  );
  assert.equal(sockets,0,'unsafe selected URL must fail before connecting to Chrome');
 }
});
