import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateCdpPageSocket} from '../src/endpoint.ts';

test('CDP page socket accepts canonical Chrome page target IDs',()=>{
 for(const id of ['ABCDEF012345','page_01','AA-bb_99','8fcd6f7a-e898-4d80-bb4b-3492fbb44090']){
  const endpoint='ws://127.0.0.1:9223/devtools/page/'+id;
  assert.equal(validateCdpPageSocket({id,webSocketDebuggerUrl:endpoint}),endpoint);
 }
});

test('CDP page socket rejects noncanonical target IDs even if the URL percent-encodes them',()=>{
 for(const id of ['','.', '..','a/b','a\\b','a b','a%2Fb','a.b','bad?fragment','abc#hash','💡']){
  const endpoint='ws://127.0.0.1:9223/devtools/page/'+encodeURIComponent(id);
  assert.throws(()=>validateCdpPageSocket({id,webSocketDebuggerUrl:endpoint}),/identity mismatch/,id);
 }
});

test('CDP page socket rejects cross-target identity and unsafe endpoint origin',()=>{
 assert.throws(()=>validateCdpPageSocket({id:'alpha',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/bravo'}),/identity mismatch/);
 assert.throws(()=>validateCdpPageSocket({id:'alpha',webSocketDebuggerUrl:'ws://127.0.0.1:9224/devtools/page/alpha'}),/port mismatch/);
});
