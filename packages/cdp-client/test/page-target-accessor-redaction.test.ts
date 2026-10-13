import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateCdpPageSocket} from '../src/endpoint.ts';

const endpoint='ws://127.0.0.1:9223/devtools/page/alpha';
const privateValue='private-session-token-should-not-leak';

test('CDP page socket redacts errors thrown by hostile target field accessors',()=>{
 for(const field of ['id','webSocketDebuggerUrl'] as const){
  const target={id:'alpha',webSocketDebuggerUrl:endpoint};
  Object.defineProperty(target,field,{get(){throw new Error(privateValue);}});
  assert.throws(()=>validateCdpPageSocket(target),error=>{
   assert.ok(error instanceof Error);
   assert.doesNotMatch(error.message,/private-session-token/);
   assert.match(error.message,/CDP page target identity mismatch|Invalid CDP debugger socket length/);
   return true;
  });
 }
});

test('CDP page socket does not expose hostile proxy traps',()=>{
 const target=new Proxy({id:'alpha',webSocketDebuggerUrl:endpoint},{get(){throw new Error(privateValue);}});
 assert.throws(()=>validateCdpPageSocket(target),error=>{
  assert.ok(error instanceof Error);
  assert.doesNotMatch(error.message,/private-session-token/);
  return true;
 });
});

test('CDP page socket still accepts plain canonical target metadata',()=>{
 assert.equal(validateCdpPageSocket({id:'alpha',webSocketDebuggerUrl:endpoint}),endpoint);
});
