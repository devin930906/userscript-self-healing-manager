import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {verifyBrowserCdpHandshake} from '../src/index.ts';

const endpoint='ws://127.0.0.1:9223/devtools/browser/isolated-fault-test';
const valid={product:'Chrome/155.0.8059.39'};
const canary='PRIVATE_BROWSER_CDP_PROTOCOL_TOKEN';

class ControlledBrowserSocket extends EventEmitter {
 readonly response:unknown;
 sent:string[]=[];
 constructor(response:unknown){
  super();
  this.response=response;
  queueMicrotask(()=>this.emit('open'));
 }
 addEventListener(name:string,handler:(event:any)=>void){this.on(name,handler);}
 removeEventListener(name:string,handler:(event:any)=>void){this.off(name,handler);}
 send(packet:string){
  this.sent.push(packet);
  const {id}=JSON.parse(packet);
  queueMicrotask(()=>this.emit('message',{
   data:JSON.stringify({id,...this.response as Record<string,unknown>}),
  }));
 }
 close(){this.emit('close');}
}

test('RG-04 clean Browser.getVersion CDP envelope still confirms exact Chrome identity',async()=>{
 const socket=new ControlledBrowserSocket({result:valid});
 assert.equal(await verifyBrowserCdpHandshake({
  endpoint,port:9223,socketFactory:()=>socket,
 }),valid.product);
 assert.deepEqual(socket.sent.map(item=>JSON.parse(item)).map(x=>x.method),['Browser.getVersion']);
});

test('RG-04 Chrome identity must reject every CDP error property even when falsy',async()=>{
 const faults=[
  {error:false},{error:0},{error:null},{error:''},
  {exceptionDetails:null},{exceptionDetails:false},
  {result:{...valid,error:0}},
  {result:{...valid,exceptionDetails:''}},
 ];
 for(const fault of faults){
  const socket=new ControlledBrowserSocket({
   result:valid,...fault,privateText:canary,
  });
  await assert.rejects(verifyBrowserCdpHandshake({
   endpoint,port:9223,socketFactory:()=>socket,
  }),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'CDP browser handshake command rejected');
   assert.doesNotMatch(error.message,/PRIVATE_BROWSER_CDP_PROTOCOL_TOKEN/);
   assert.equal('cause' in error,false);
   return true;
  });
  assert.deepEqual(socket.sent.map(item=>JSON.parse(item)).map(x=>x.method),['Browser.getVersion']);
 }
});
