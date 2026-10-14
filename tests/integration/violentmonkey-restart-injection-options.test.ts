import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

async function responseFor(options:unknown){
 const builder=(contract as Record<string,unknown>).buildViolentmonkeyManagerInjectionOptionsExpression;
 assert.equal(typeof builder,'function','official manager injection-options probe is missing');
 const expression=(builder as ()=>string)();
 const listeners=new Set<(e:any)=>void>();
 const requests:any[]=[];
 const context=vm.createContext({
  navigator:{serviceWorker:{
   controller:null,ready:Promise.resolve({active:{postMessage(message:any){
    requests.push(message);
    queueMicrotask(()=>{for(const cb of listeners)cb({data:{id:message.id,res:options}});});
   }}}),
   addEventListener(_event:string,cb:(event:any)=>void){listeners.add(cb);},
   removeEventListener(_event:string,cb:(event:any)=>void){listeners.delete(cb);},
  }},JSON,Promise,setTimeout,clearTimeout,
 });
 const result=await vm.runInContext(expression,context);
 assert.equal(requests.length,1);
 assert.equal(requests[0].msg.cmd,'GetAllOptions','only official manager read-only options command allowed');
 assert.deepEqual(JSON.parse(JSON.stringify(requests[0].msg.data)),{});
 return result;
}

test('RG-05 official manager options probe returns only fixed injection-activation booleans',async()=>{
 assert.equal(await responseFor({isApplied:true,ffInject:false,xhrInject:false,token:'PRIVATE'}),
  JSON.stringify({applied:true,fastInject:false,xhrInject:false}));
 assert.equal(await responseFor({isApplied:false,ffInject:true,xhrInject:true,token:'PRIVATE'}),
  JSON.stringify({applied:false,fastInject:true,xhrInject:true}));
 assert.equal(await responseFor({token:'PRIVATE'}),
  JSON.stringify({applied:false,fastInject:false,xhrInject:false}));
});

test('RG-05 official manager CFT verifies activation both before initial injection and after process restart',async()=>{
 const text=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const positions=[...text.matchAll(/readManagerInjectionOptions\(optionsCdp/g)].map(m=>m.index);
 assert.equal(positions.length,2,'read-only options check must run before and after browser restart');
 const original=text.indexOf("console.log('RG-05 fixed stage: first-document')");
 const restarted=text.indexOf("const createdRestartFixture=await browserCdp.send('Target.createTarget'");
 assert.ok(positions[0]!<original&&positions[1]!<restarted);
 assert.match(text,/RG-05 official manager options differ|RG-05 official manager injection disabled/);
 assert.doesNotMatch(text,/console\.log\([^\n]*PRIVATE|console\.log\([^\n]*fullOptions/);
});
