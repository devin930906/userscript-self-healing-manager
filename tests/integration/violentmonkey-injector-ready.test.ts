import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const api=contract as any;
test('the official injector is initialized again after permission grant through the manager worker channel',async()=>{
 assert.equal(typeof api.buildViolentmonkeyInjectorReadyExpression,'function');
 const expression=api.buildViolentmonkeyInjectorReadyExpression();
 for(const response of [undefined,null,'private injector failure',{message:'private injector failure'}]){
  const listeners=new Set<any>();
  const endpoint={controller:null,ready:Promise.resolve({active:{postMessage(packet:any){
   assert.equal(packet.msg.cmd,'GetInjectorError');
   assert.equal(Object.keys(packet.msg.data).length,0);
   queueMicrotask(()=>{for(const listener of listeners)listener({data:{id:packet.id,res:response}});});
  }}}),addEventListener(_type:string,listener:any){listeners.add(listener);},
   removeEventListener(_type:string,listener:any){listeners.delete(listener);}};
  const result=await vm.runInNewContext(expression,{navigator:{serviceWorker:endpoint},setTimeout,clearTimeout,JSON,Promise});
  assert.equal(result,JSON.stringify({ready:response===null||response===undefined}));
  assert.equal(listeners.size,0);
  assert.doesNotMatch(result,/private injector failure/);
 }
});

test('injector readiness checks the exact official base files rather than API permission alone',async()=>{
 assert.equal(typeof api.buildViolentmonkeyInjectorProbeExpression,'function');
 const expression=api.buildViolentmonkeyInjectorProbeExpression();
 const expected={id:'1001',runAt:'document_start',allFrames:true,
  js:[{file:'injected-web.js'},{file:'injected.js'}],matches:['<all_urls>']};
 for(const scripts of [[],[expected],[{...expected,js:[{code:'private source'}]}],
  [{...expected,id:'1002'}],[{...expected,runAt:'document_idle'}]]){
  const result=await vm.runInNewContext(expression,{JSON,Array,chrome:{userScripts:{async getScripts(query:any){
   assert.equal(JSON.stringify(query),JSON.stringify({ids:['1001']}));return scripts;
  }}}});
  assert.equal(result,JSON.stringify({ready:scripts[0]===expected}));
  assert.doesNotMatch(result,/private source/);
 }
});

test('isolated manager readiness waits for BOTH an exact official worker receipt and registered injector files',async()=>{
 let worker=0,probe=0;
 const attempts:string[]=[];let sleeps=0;
 const send=async(method:string,params:any)=>{
  assert.equal(method,'Runtime.evaluate');
  assert.equal(params.awaitPromise,true);
  assert.equal(params.returnByValue,true);
  if(params.expression===api.buildViolentmonkeyInjectorReadyExpression()){
   worker++;
   return worker===1?{result:{value:null}}:{result:{value:JSON.stringify({ready:true})}};
  }
  assert.equal(params.expression,api.buildViolentmonkeyInjectorProbeExpression());
  probe++;
  return {result:{value:JSON.stringify({ready:probe>=2})}};
 };
 await api.waitForVerifiedViolentmonkeyInjector({
  send,hasExited:()=>false,delay:async(ms:number)=>{
   assert.ok(ms>0&&ms<=1000);sleeps++;
  },onStatus:(s:string)=>{attempts.push(s);},
 });
 assert.equal(worker,3);assert.equal(probe,2);assert.equal(sleeps,2);
 assert.deepEqual(attempts,['worker-receipt-unavailable','base-injector-unregistered','ready']);
});

test('isolated injector initialization never succeeds on missing, false or malformed official receipts',async()=>{
 for(const receipt of [null,undefined,JSON.stringify({ready:false}),JSON.stringify({ready:'true'}),
  JSON.stringify({ready:true,unexpected:'forged'}),'private extension detail']){
  let calls=0,delays=0;
  const error=await api.waitForVerifiedViolentmonkeyInjector({
   send:async()=>{calls++;return {result:{value:receipt}};},
   hasExited:()=>false,delay:async()=>{delays++;},
  }).catch((e:any)=>e);
  assert.ok(error instanceof Error);
  assert.match(error.message,/injector|manager|readiness/i);
  assert.doesNotMatch(error.message,/private extension detail/);
  assert.equal(calls,16,'missing or invalid official readiness must exhaust a strict finite bound');
  assert.equal(delays,15);
 }
});

test('isolated injector never accepts official ready unless exact base injector is registered',async()=>{
 let official=0,probes=0;
 const statuses:string[]=[];
 const err=await api.waitForVerifiedViolentmonkeyInjector({
  send:async(_method:string,params:any)=>{
   if(params.expression===api.buildViolentmonkeyInjectorReadyExpression()){
    official++;return {result:{value:JSON.stringify({ready:true})}};
   }
   probes++;return {result:{value:JSON.stringify({ready:false})}};
  },
  hasExited:()=>false,delay:async()=>{},
  onStatus:(stage:string)=>statuses.push(stage),
 }).catch((e:any)=>e);
 assert.ok(err instanceof Error);
 assert.equal(official,16);assert.equal(probes,16);
 assert.equal(statuses.at(-1),'base-injector-unregistered');
 assert.match(err.message,/base injector/i);
});

test('isolated injector aborts on CFT exit and does not leak CDP exception content',async()=>{
 let sends=0;
 await assert.rejects(api.waitForVerifiedViolentmonkeyInjector({
  send:async()=>{sends++;return {result:{value:JSON.stringify({ready:true})}};},
  hasExited:()=>true,delay:async()=>{},
 }),/exited|closed/i);
 assert.equal(sends,0);
 const err=await api.waitForVerifiedViolentmonkeyInjector({
  send:async()=>({exceptionDetails:{text:'PRIVATE_EXTENSION_ERROR_SENTINEL'}}),
  hasExited:()=>false,delay:async()=>{},
 }).catch((e:any)=>e);
 assert.ok(err instanceof Error);
 assert.doesNotMatch(err.message,/PRIVATE_EXTENSION_ERROR_SENTINEL/);
 assert.match(err.message,/evaluate|CDP|readiness/i);
});

test('official manager smoke uses the bounded verified injector gate instead of a one-shot receipt',async()=>{
 const {readFile}=await import('node:fs/promises');
 const script=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 assert.match(script,/await waitForVerifiedViolentmonkeyInjector\(\{/);
 assert.doesNotMatch(script,/const initialized=await optionsCdp\.send\('Runtime\.evaluate'/);
 assert.doesNotMatch(script,/const injector=await optionsCdp\.send\('Runtime\.evaluate'/);
});

test('RG-05 distinguishes sanitized CDP evaluation failure from official injector-not-ready',async()=>{
 const stages:string[]=[];
 const error=await api.waitForVerifiedViolentmonkeyInjector({
  send:async()=>{throw new Error('PRIVATE_CDP_TRANSPORT_SENTINEL');},
  hasExited:()=>false,delay:async()=>{},
  onStatus:(stage:string)=>stages.push(stage),
 }).catch((cause:any)=>cause);
 assert.ok(error instanceof Error);
 assert.deepEqual(stages,['cdp-evaluation-failed']);
 assert.match(error.message,/CDP evaluation failed/);
 assert.doesNotMatch(error.message,/PRIVATE_CDP_TRANSPORT_SENTINEL/);
});

test('RG-05 rejects a returned CDP error envelope without retrying or exposing its private payload',async()=>{
 const stages:string[]=[];
 let calls=0,sleeps=0;
 const cause=await api.waitForVerifiedViolentmonkeyInjector({
  send:async()=>{calls++;return {error:{code:-32000,message:'PRIVATE_CDP_ERROR_ENVELOPE'}};},
  hasExited:()=>false,delay:async()=>{sleeps++;},
  onStatus:(stage:string)=>stages.push(stage),
 }).catch((error:any)=>error);
 assert.ok(cause instanceof Error);
 assert.match(cause.message,/CDP evaluation failed/);
 assert.doesNotMatch(cause.message,/PRIVATE_CDP_ERROR_ENVELOPE/);
 assert.deepEqual(stages,['cdp-evaluation-failed']);
 assert.equal(calls,1,'a transport error response must fail closed rather than poll sixteen times');
 assert.equal(sleeps,0);
});

test('RG-05 never accepts a CDP response carrying an error field even if its value is falsy',async()=>{
 for(const errorValue of [null,false,0,'']){
  let calls=0;
  const stages:string[]=[];
  const error=await api.waitForVerifiedViolentmonkeyInjector({
   send:async()=>{calls++;return {error:errorValue,result:{value:JSON.stringify({ready:true})}};},
   hasExited:()=>false,delay:async()=>{},
   onStatus:(stage:string)=>stages.push(stage),
  }).catch((cause:any)=>cause);
  assert.ok(error instanceof Error);
  assert.match(error.message,/CDP evaluation failed/);
  assert.equal(calls,1,'a suspicious CDP error envelope must never be retried or accepted');
  assert.deepEqual(stages,['cdp-evaluation-failed']);
 }
});

test('RG-05 classifies only exact synthetic CDP transport failures as bounded status labels',async()=>{
 for(const [message,expected] of [
  ['CDP command timed out','cdp-timeout'],
  ['CDP WebSocket closed','cdp-websocket-closed'],
  ['PRIVATE_UNTRUSTED_DETAIL','cdp-evaluation-failed'],
 ]){
  const stages:string[]=[];
  let calls=0;
  const error=await api.waitForVerifiedViolentmonkeyInjector({
   send:async()=>{calls++;throw new Error(message);},
   hasExited:()=>false,delay:async()=>{},
   onStatus:(stage:string)=>stages.push(stage),
  }).catch((cause:any)=>cause);
  assert.ok(error instanceof Error);
  assert.deepEqual(stages,[expected]);
  assert.equal(calls,1);
  assert.doesNotMatch(error.message,/PRIVATE_UNTRUSTED_DETAIL/);
 }
});

test('RG-05 rejects explicit falsy CDP exceptionDetails despite forged ready receipt',async()=>{
 for(const exceptionDetails of [null,false,0,'']){
  const statuses:string[]=[];
  let calls=0;
  const error=await api.waitForVerifiedViolentmonkeyInjector({
   send:async()=>{calls++;return {exceptionDetails,result:{value:JSON.stringify({ready:true})}};},
   hasExited:()=>false,delay:async()=>{},
   onStatus:(stage:string)=>statuses.push(stage),
  }).catch((cause:any)=>cause);
  assert.ok(error instanceof Error);
  assert.match(error.message,/CDP evaluation failed/);
  assert.deepEqual(statuses,['cdp-evaluation-failed']);
  assert.equal(calls,1);
 }
});

test('RG-05 sanitizes hostile CDP response field access before any injector readiness promotion',async()=>{
 for(const hostileField of ['result','value']){
  const statuses:string[]=[];
  let calls=0;
  const privateText='PRIVATE_CDP_RESPONSE_GETTER';
  const result=hostileField==='result'
   ?Object.defineProperty({},'result',{get(){throw new Error(privateText);}})
   :{result:Object.defineProperty({},'value',{get(){throw new Error(privateText);}})};
  const error=await api.waitForVerifiedViolentmonkeyInjector({
   send:async()=>{calls++;return result;},
   hasExited:()=>false,delay:async()=>{},
   onStatus:(stage:string)=>statuses.push(stage),
  }).catch((cause:any)=>cause);
  assert.ok(error instanceof Error);
  assert.equal(error.message,'Isolated manager injector CDP evaluation failed');
  assert.deepEqual(statuses,['cdp-evaluation-failed']);
  assert.equal(calls,1);
 }
});

test('RG-05 does not accept inherited CDP result and value fields',async()=>{
 for(const response of [
  Object.create({result:{value:JSON.stringify({ready:true})}}),
  {result:Object.create({value:JSON.stringify({ready:true})})},
 ]){
  let calls=0;
  const stages:string[]=[];
  const error=await api.waitForVerifiedViolentmonkeyInjector({
   send:async()=>{calls++;return response;},
   hasExited:()=>false,delay:async()=>{},
   onStatus:(stage:string)=>stages.push(stage),
  }).catch((cause:any)=>cause);
  assert.ok(error instanceof Error);
  assert.equal(error.message,'Isolated manager injector CDP evaluation failed');
  assert.equal(calls,1);
  assert.deepEqual(stages,['cdp-evaluation-failed']);
 }
});
