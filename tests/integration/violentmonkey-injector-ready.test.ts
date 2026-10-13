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
