import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateCdpBrowserSocket,validateCdpPageSocket} from '../src/endpoint.ts';

test('CDP endpoint inputs have bounded opaque identities and bounded socket URL size',()=>{
 const valid='ws://127.0.0.1:9223/devtools/browser/abc';
 assert.equal(validateCdpBrowserSocket(valid),valid);
 const id='a'.repeat(128);
 assert.equal(validateCdpPageSocket({id,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/'+id}),
  'ws://127.0.0.1:9223/devtools/page/'+id);
 const tooLong='a'.repeat(129);
 assert.throws(()=>validateCdpPageSocket({id:tooLong,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/'+tooLong}),/identity mismatch/);
 assert.throws(()=>validateCdpBrowserSocket('ws://127.0.0.1:9223/devtools/browser/'+tooLong),/identity mismatch/);
 const oversized='ws://127.0.0.1:9223/devtools/browser/'+'x'.repeat(2050);
 assert.throws(()=>validateCdpBrowserSocket(oversized),/length/);
 assert.throws(()=>validateCdpPageSocket({id:'a',webSocketDebuggerUrl:oversized}),/length/);
});

test('CDP page target rejects absent or malformed target before dereference',()=>{
 for(const target of [undefined,null,42,'page',{}]){
  assert.throws(()=>validateCdpPageSocket(target as Parameters<typeof validateCdpPageSocket>[0]),/identity mismatch|no debugger socket/);
 }
});
