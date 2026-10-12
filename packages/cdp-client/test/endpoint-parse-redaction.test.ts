import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateCdpBrowserSocket,validateCdpPageSocket} from '../src/endpoint.ts';

test('malformed browser debugger URLs are rejected with sanitized diagnostics',()=>{
 for(const bad of ['not-a-url','ws://[','%broken','ws://127.0.0.1:abc/devtools/browser/a']){
  assert.throws(()=>validateCdpBrowserSocket(bad),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid CDP debugger socket URL');
   assert.doesNotMatch(error.message,/not-a-url|%broken|127.0.0.1/);
   return true;
  });
 }
});
test('malformed page debugger URLs are rejected with sanitized diagnostics',()=>{
 assert.throws(()=>validateCdpPageSocket({id:'alpha',webSocketDebuggerUrl:'ws://['}),
  /Invalid CDP debugger socket URL/);
 assert.equal(validateCdpPageSocket({id:'alpha',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/alpha'}),
  'ws://127.0.0.1:9223/devtools/page/alpha');
});
