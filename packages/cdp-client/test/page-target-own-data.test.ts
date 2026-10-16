import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateCdpPageSocket} from '../src/endpoint.ts';

const url='ws://127.0.0.1:9223/devtools/page/alpha';

test('RG-04 rejects accessor-backed page target fields without executing getters',()=>{
 for(const field of ['id','webSocketDebuggerUrl'] as const){
  let calls=0;
  const target:{id:string;webSocketDebuggerUrl:string}={id:'alpha',webSocketDebuggerUrl:url};
  Object.defineProperty(target,field,{enumerable:true,get(){calls++;return field==='id'?'alpha':url;}});
  assert.throws(()=>validateCdpPageSocket(target),/CDP page target identity mismatch|Invalid CDP debugger socket/);
  assert.equal(calls,0,field+' getter must not execute');
 }
});

test('RG-04 rejects inherited page identity or debugger socket instead of authenticating prototype data',()=>{
 const inheritedId=Object.assign(Object.create({id:'alpha'}),{webSocketDebuggerUrl:url});
 const inheritedSocket=Object.assign(Object.create({webSocketDebuggerUrl:url}),{id:'alpha'});
 for(const target of [inheritedId,inheritedSocket]){
  assert.throws(()=>validateCdpPageSocket(target),/CDP page target identity mismatch|no debugger socket/);
 }
});

test('RG-04 accepts literal own-data Chrome page target and distinguishes missing socket',()=>{
 assert.equal(validateCdpPageSocket({id:'alpha',webSocketDebuggerUrl:url}),url);
 assert.throws(()=>validateCdpPageSocket({id:'alpha'}),/no debugger socket/);
});

test('RG-04 rejects proxy-backed CDP targets before invoking descriptor traps',()=>{
 let trapCalls=0;
 const target=new Proxy({id:'alpha',webSocketDebuggerUrl:url},{
  getOwnPropertyDescriptor(object,key){trapCalls++;return Reflect.getOwnPropertyDescriptor(object,key);},
 });
 assert.throws(()=>validateCdpPageSocket(target),/CDP page target identity mismatch/);
 assert.equal(trapCalls,0,'untrusted proxy descriptor traps must never run');
});
