import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkUserscriptPageScope} from '../src/page-scope.ts';

const safeUrl='https://example.org/private/account';
const allow=['https://example.org/*'];
const deny=['https://example.org/private/*'];

/**
 * Scope authorization must not execute ANY Proxy reflection trap before
 * rejecting hostile metadata. A later structuredClone() rejection is too late:
 * ownKeys/getOwnPropertyDescriptor traps can already run arbitrary JS.
 */
test('RG-01 rejects a root metadata Proxy without invoking reflection traps',()=>{
 let trapCalls=0;
 const ordinary={match:allow,include:[],raw:{'exclude-match':deny}};
 const hostile=new Proxy(ordinary,{
  getOwnPropertyDescriptor(target,key){trapCalls++;return Reflect.getOwnPropertyDescriptor(target,key);},
  ownKeys(target){trapCalls++;return Reflect.ownKeys(target);},
  get(target,key,receiver){trapCalls++;return Reflect.get(target,key,receiver);},
 });
 assert.equal(checkUserscriptPageScope(hostile,safeUrl).status,'unknown');
 assert.equal(trapCalls,0,'untrusted root Proxy traps must not execute');
});

test('RG-01 rejects nested raw and rules-array Proxies before descriptor access',()=>{
 for(const placement of ['raw','match','include','exclude','exclude-match'] as const){
  let trapCalls=0;
  const dangerous=new Proxy(placement==='raw'?{'exclude-match':deny}:deny,{
   getOwnPropertyDescriptor(target,key){trapCalls++;return Reflect.getOwnPropertyDescriptor(target,key);},
   ownKeys(target){trapCalls++;return Reflect.ownKeys(target);},
   get(target,key,receiver){trapCalls++;return Reflect.get(target,key,receiver);},
   has(target,key){trapCalls++;return Reflect.has(target,key);},
  });
  const meta:{match:unknown;include:unknown;raw:Record<string,unknown>|unknown}={
   match:allow,include:[],raw:{'exclude-match':deny},
  };
  if(placement==='raw')meta.raw=dangerous;
  else if(placement==='match')meta.match=dangerous;
  else if(placement==='include')meta.include=dangerous;
  else (meta.raw as Record<string,unknown>)[placement]=dangerous;
  const verdict=checkUserscriptPageScope(meta as any,safeUrl);
  assert.equal(verdict.status,'unknown',placement+' Proxy must fail closed');
  assert.equal(trapCalls,0,placement+' Proxy traps must not execute');
 }
});

test('RG-01 rejects a revoked Proxy without invoking its traps or leaking errors',()=>{
 const {proxy,revoke}=Proxy.revocable({match:allow,include:[],raw:{}},{});
 revoke();
 assert.deepEqual(checkUserscriptPageScope(proxy,safeUrl).status,'unknown');
 assert.equal(checkUserscriptPageScope({match:allow,include:[],raw:{}},safeUrl).status,'allowed');
});
