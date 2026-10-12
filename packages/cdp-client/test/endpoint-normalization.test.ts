import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateCdpBrowserSocket,validateCdpPageSocket} from '../src/endpoint.ts';

test('browser CDP socket rejects URL parser normalized aliases, including dot-segment traversal',()=>{
 const good='ws://127.0.0.1:9223/devtools/browser/alpha';
 assert.equal(validateCdpBrowserSocket(good),good);
 for(const bad of [
  'ws://127.0.0.1:9223/devtools/browser/../browser/alpha',
  'ws://127.0.0.1:9223/devtools/browser/%2e%2e/browser/alpha',
  'ws://127.0.0.1:9223/devtools/./browser/alpha',
  'WS://127.0.0.1:9223/devtools/browser/alpha',
  'ws://LOCALHOST:9223/devtools/browser/alpha',
 ]){
  assert.throws(()=>validateCdpBrowserSocket(bad),/Noncanonical CDP debugger socket URL/,bad);
 }
});

test('page CDP socket rejects normalized aliases even when target ID matches',()=>{
 const id='alpha';
 const good='ws://127.0.0.1:9223/devtools/page/alpha';
 assert.equal(validateCdpPageSocket({id,webSocketDebuggerUrl:good}),good);
 for(const bad of [
  'ws://127.0.0.1:9223/devtools/page/../page/alpha',
  'ws://127.0.0.1:9223/devtools/page/%2e%2e/page/alpha',
 ]){
  assert.throws(()=>validateCdpPageSocket({id,webSocketDebuggerUrl:bad}),/Noncanonical CDP debugger socket URL/);
 }
});
