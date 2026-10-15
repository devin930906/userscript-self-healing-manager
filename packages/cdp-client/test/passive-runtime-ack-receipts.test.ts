import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {observeReadOnlyPageExceptions} from '../src/read-only-exceptions.ts';

const target={
 type:'page',id:'fr018-runtime-ack',url:'https://example.test/page',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fr018-runtime-ack',
};
const confirmed=()=>({
 targetId:target.id,confirmedUrl:target.url,frameId:'main',loaderId:'loader-one',
});

type Fault='nested-error'|'nested-exception'|'outer-exception';
const unsafeAck=(id:number,fault:Fault)=>{
 if(fault==='nested-error')return {id,result:{error:false,marker:'PRIVATE_SECRET_SHOULD_NOT_LEAK'}};
 if(fault==='nested-exception')return {id,result:{exceptionDetails:null}};
 return {id,result:{},exceptionDetails:null};
};
class AckSocket extends EventEmitter{
 readonly sent:string[]=[];
 closed=0;
 constructor(privateFault:Fault,privateStage:'Runtime.enable'|'Runtime.disable'|'none'){
  super();
  this.fault=privateFault;
  this.stage=privateStage;
  queueMicrotask(()=>this.emit('open'));
 }
 readonly fault:Fault;
 readonly stage:'Runtime.enable'|'Runtime.disable'|'none';
 addEventListener(event:string,callback:(value:any)=>void){this.on(event,callback);}
 removeEventListener(event:string,callback:(value:any)=>void){this.off(event,callback);}
 send(payload:string){
  const request=JSON.parse(payload) as {id:number;method:string};
  this.sent.push(request.method);
  const ack=request.method===this.stage?
   unsafeAck(request.id,this.fault):{id:request.id,result:{}};
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify(ack)}));
 }
 close(){this.closed++;this.emit('close');}
}

test('FR-018 rejects malformed Runtime.enable acknowledgements before opening a false zero window',async()=>{
 for(const fault of ['nested-error','nested-exception','outer-exception'] as const){
  const socket=new AckSocket(fault,'Runtime.enable');
  await assert.rejects(observeReadOnlyPageExceptions(target,{
   approved:true,durationMs:100,confirm:async()=>confirmed(),socketFactory:()=>socket,
  }),error=>{
   assert.ok(error instanceof Error);
   assert.match(error.message,/Runtime exception observer rejected|CDP/i);
   assert.doesNotMatch(JSON.stringify(error),/PRIVATE_SECRET|example[.]test/);
   return true;
  },fault);
  assert.deepEqual(socket.sent,['Runtime.enable'],fault);
  assert.equal(socket.closed,1);
  assert.equal(socket.listenerCount('message'),0);
 }
});

test('FR-018 malformed Runtime.disable acknowledgements invalidate zero-event evidence',async()=>{
 for(const fault of ['nested-error','nested-exception','outer-exception'] as const){
  const socket=new AckSocket(fault,'Runtime.disable');
  const evidence=await observeReadOnlyPageExceptions(target,{
   approved:true,durationMs:100,confirm:async()=>confirmed(),socketFactory:()=>socket,
  });
  assert.equal(evidence.status,'unknown',fault);
  assert.equal(evidence.observedCount,null,fault);
  assert.equal(evidence.origin,'unknown');
  assert.equal(evidence.V4,'not-configured');
  assert.deepEqual(socket.sent,['Runtime.enable','Runtime.disable']);
  assert.equal(socket.closed,1);
  assert.doesNotMatch(JSON.stringify(evidence),/PRIVATE_SECRET|example[.]test/);
 }
});

test('FR-018 damaged Runtime.disable ack cannot preserve previously counted exception evidence',async()=>{
 class ExceptionBeforeDisable extends AckSocket{
  override send(payload:string){
   const command=JSON.parse(payload) as {method:string};
   super.send(payload);
   if(command.method==='Runtime.enable')
    queueMicrotask(()=>this.emit('message',{data:JSON.stringify({
     method:'Runtime.exceptionThrown',params:{exceptionDetails:{
      exceptionId:42,text:'PRIVATE_SECRET_SHOULD_NOT_LEAK',
     }},
    })}));
  }
 }
 const socket=new ExceptionBeforeDisable('nested-error','Runtime.disable');
 const evidence=await observeReadOnlyPageExceptions(target,{
  approved:true,durationMs:100,confirm:async()=>confirmed(),socketFactory:()=>socket,
 });
 assert.equal(evidence.status,'unknown');
 assert.equal(evidence.observedCount,null);
 assert.equal(evidence.V3,'not-configured');
 assert.equal(socket.closed,1);
 assert.doesNotMatch(JSON.stringify(evidence),/PRIVATE_SECRET/);
});

test('FR-018 genuine empty CDP runtime acknowledgements still allow count-only zero evidence',async()=>{
 const socket=new AckSocket('nested-error','none');
 const evidence=await observeReadOnlyPageExceptions(target,{
  approved:true,durationMs:100,confirm:async()=>confirmed(),socketFactory:()=>socket,
 });
 assert.equal(evidence.status,'none-observed');
 assert.equal(evidence.observedCount,0);
 assert.deepEqual(socket.sent,['Runtime.enable','Runtime.disable']);
 assert.equal(socket.closed,1);
});
