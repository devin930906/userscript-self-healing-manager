import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateCdpPageSocket} from '../src/endpoint.ts';

test('CDP page target rejects a non-string debugger socket before URL parsing',()=>{
 for(const endpoint of [42,true,{},[],Symbol('private'),new URL('ws://127.0.0.1:9223/devtools/page/alpha')]){
  assert.throws(()=>validateCdpPageSocket({id:'alpha',webSocketDebuggerUrl:endpoint as string}),
   /Invalid CDP debugger socket length/);
 }
});

test('CDP page target distinguishes a missing socket from malformed typed sockets',()=>{
 for(const endpoint of [undefined,null,'']){
  assert.throws(()=>validateCdpPageSocket({id:'alpha',webSocketDebuggerUrl:endpoint as string}),
   /no debugger socket/);
 }
 const canonical='ws://127.0.0.1:9223/devtools/page/alpha';
 assert.equal(validateCdpPageSocket({id:'alpha',webSocketDebuggerUrl:canonical}),canonical);
});
