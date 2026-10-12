import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateCdpBrowserSocket} from '../src/endpoint.ts';

test('CDP browser socket permits canonical local opaque debugger IDs',()=>{
 for(const id of ['abc','valid_01','AA-bb_99','8fcd6f7a-e898-4d80-bb4b-3492fbb44090']){
  assert.equal(validateCdpBrowserSocket('ws://127.0.0.1:9223/devtools/browser/'+id),
   'ws://127.0.0.1:9223/devtools/browser/'+id);
 }
});

test('CDP browser socket rejects ambiguous encoded separators, traversal and extra paths',()=>{
 for(const suffix of ['.', '..','a%2Fb','a%5Cb','a%2eb','a.b','a%20b','a/b','a?key=x','a#fragment','a%252fb']){
  const endpoint='ws://127.0.0.1:9223/devtools/browser/'+suffix;
  assert.throws(()=>validateCdpBrowserSocket(endpoint),/identity|endpoint|socket|URL|Invalid/i,suffix);
 }
});

test('CDP browser socket rejects foreign ports and hosts',()=>{
 for(const endpoint of ['ws://127.0.0.1:9224/devtools/browser/abc','ws://evil.test:9223/devtools/browser/abc','wss://127.0.0.1:9223/devtools/browser/abc']){
  assert.throws(()=>validateCdpBrowserSocket(endpoint),/port|loopback|socket/i);
 }
});
