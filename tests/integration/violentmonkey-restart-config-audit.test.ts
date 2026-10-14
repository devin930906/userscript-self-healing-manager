import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const fixtureUrl='http://127.0.0.1:49152/fixture';
const name='USSHM Isolated Violentmonkey V4 Fixture';
const namespace='https://usshm.invalid/isolated-fixture';
const grants=['GM_getValue','GM_setValue','GM_registerMenuCommand','GM_xmlhttpRequest'];

async function evaluateReadOnly(expression:string,response:unknown):Promise<{data:any;receipt:any}>{
 const listeners=new Set<(event:any)=>void>();
 const sent:any[]=[];
 const active={postMessage(packet:any){
  sent.push(packet);
  queueMicrotask(()=>{for(const listener of listeners)listener({data:{id:packet.id,res:response}});});
 }};
 const scope=vm.createContext({navigator:{serviceWorker:{
  controller:null,ready:Promise.resolve({active}),
  addEventListener(_kind:string,listener:(event:any)=>void){listeners.add(listener);},
  removeEventListener(_kind:string,listener:(event:any)=>void){listeners.delete(listener);},
 }},JSON,Promise,setTimeout,clearTimeout});
 const raw=await vm.runInContext(expression,scope);
 return {data:sent[0]?.msg,receipt:JSON.parse(raw)};
}

test('RG-05 official manager restart audit reduces the exact persisted userscript to enabled/scope/GM booleans',async()=>{
 const builder=(contract as Record<string,unknown>).buildViolentmonkeyFixtureRuntimeConfigurationExpression;
 assert.equal(typeof builder,'function','missing official manager persisted fixture configuration audit');
 const build=builder as (name:string,namespace:string,url:string)=>string;
 const expression=build(name,namespace,fixtureUrl);
 const fixture={meta:{name,namespace,match:[fixtureUrl],grant:grants},config:{enabled:1},code:'PRIVATE_SCRIPT_BODY'};
 const {data,receipt}=await evaluateReadOnly(expression,{scripts:[fixture]});
 assert.deepEqual(JSON.parse(JSON.stringify(data?.data)),{sizes:false});
 assert.equal(data?.cmd,'GetData');
 assert.deepEqual(JSON.parse(JSON.stringify(receipt)),{present:true,enabled:true,scope:true,gmGrants:true});
 assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE_SCRIPT_BODY/);
 for(const [change,field] of [
  [(s:any)=>{s.config.enabled=0;},'enabled'],
  [(s:any)=>{s.meta.match=['https://other.invalid/*'];},'scope'],
  [(s:any)=>{s.meta.grant=['GM_getValue'];},'gmGrants'],
 ] as const){
  const altered=structuredClone(fixture);change(altered);
  const checked=await evaluateReadOnly(expression,{scripts:[altered]});
  assert.equal(checked.receipt.present,true);
  assert.equal(checked.receipt[field],false,field+' must distinguish installed from injectable');
 }
 assert.deepEqual((await evaluateReadOnly(expression,{scripts:[]})).receipt,{present:false,enabled:false,scope:false,gmGrants:false});
 assert.throws(()=>build(name,namespace,'https://real.example/fixture'),/fixture|loopback|scope/i);
});

test('RG-05 cross-process CFT smoke checks persisted official manager enabled, match and GM grants before reporting injector readiness',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 assert.match(source,/buildViolentmonkeyFixtureRuntimeConfigurationExpression\(/);
 assert.match(source,/persistedConfig\.present===true/);
 assert.match(source,/persistedConfig\.enabled===true/);
 assert.match(source,/persistedConfig\.scope===true/);
 assert.match(source,/persistedConfig\.gmGrants===true/);
 assert.doesNotMatch(source,/console\.log\([^\n]*persistedConfig\)/,'never print raw manager inventory');
});
