import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {buildViolentmonkeyInjectorReadyExpression} from '../../scripts/violentmonkey-v4-contract.ts';

/**
 * Fixed synthetic service-worker messages only. The official manager must
 * explicitly supply its own GetInjectorError response; an id-only packet
 * cannot be treated as a successful undefined/null error response.
 */
async function evaluateOfficialInjectorReply(fields:Record<string,unknown>){
 const listeners=new Set<(message:{data:unknown})=>void>();
 const commands:unknown[]=[];
 const worker={
  postMessage(command:{id:number,msg:{cmd:string}}){
   commands.push(command);
   queueMicrotask(()=>{
    const packet={id:command.id,...fields};
    for(const listener of [...listeners])listener({data:packet});
   });
  },
 };
 const serviceWorker={
  controller:null,
  ready:Promise.resolve({active:worker}),
  addEventListener(type:string,handler:(message:{data:unknown})=>void){
   assert.equal(type,'message');
   listeners.add(handler);
  },
  removeEventListener(type:string,handler:(message:{data:unknown})=>void){
   assert.equal(type,'message');
   listeners.delete(handler);
  },
 };
 const result=await vm.runInNewContext(buildViolentmonkeyInjectorReadyExpression(),{
  navigator:{serviceWorker},Promise,JSON,setTimeout,clearTimeout,
 });
 assert.equal(commands.length,1);
 assert.equal((commands[0] as {msg:{cmd:string}}).msg.cmd,'GetInjectorError');
 assert.equal(listeners.size,0,'a completed receipt must detach its listener');
 assert.equal(typeof result,'string');
 return result as string;
}

test('RG-05 official injector readiness never accepts an id-only or error-only response as ready',async()=>{
 for(const fields of [{},{err:false},{err:null},{err:0},{err:''}]){
  assert.equal(await evaluateOfficialInjectorReply(fields),JSON.stringify({ready:false}),
   'matching request id without its own res is not an official readiness receipt');
 }
});

test('RG-05 official injector readiness accepts explicit null/undefined success and rejects actual errors',async()=>{
 for(const fields of [{res:null},{res:undefined}]){
  assert.equal(await evaluateOfficialInjectorReply(fields),JSON.stringify({ready:true}));
 }
 for(const fields of [{res:'manager injector not initialized'},{
  err:{message:'PRIVATE official manager exception'},res:undefined,
 }]){
  const result=await evaluateOfficialInjectorReply(fields);
  assert.notEqual(result,JSON.stringify({ready:true}));
  assert.doesNotMatch(result,/PRIVATE|manager injector not initialized/);
 }
});
