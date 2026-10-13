import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {confirmPageIdentity} from '../src/page-identity.ts';

const target={
 type:'page',id:'fixture-page',url:'https://fixture.example.invalid/editor',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fixture-page',
};
const canary='PRIVATE_FRAME_DIAGNOSTIC_CANARY';

class SyntheticFrameSocket extends EventEmitter {
 readonly mode:'bad-json'|'private-field'|'send-error';
 constructor(mode:SyntheticFrameSocket['mode']){
  super();this.mode=mode;queueMicrotask(()=>this.emit('open'));
 }
 addEventListener(name:string,listener:(event:any)=>void){this.on(name,listener);}
 removeEventListener(name:string,listener:(event:any)=>void){this.off(name,listener);}
 send(command:string){
  if(this.mode==='send-error')throw new Error(canary+' sent by untrusted transport');
  const id=JSON.parse(command).id;
  const data=this.mode==='bad-json'?
   canary:
   JSON.stringify({id,result:{
    frameTree:{frame:{id:'frame',loaderId:'loader'}},
    [canary]: 'synthetic-data',
   }});
  queueMicrotask(()=>this.emit('message',{data}));
 }
 close(){this.emit('close');}
}

test('RG-07 frame-tree CDP parser, response fields and send errors never reveal private data',async()=>{
 for(const mode of ['bad-json','private-field','send-error'] as const){
  let socket:SyntheticFrameSocket|undefined;
  await assert.rejects(
   confirmPageIdentity(target,{socketFactory:()=>{
    socket=new SyntheticFrameSocket(mode);
    return socket;
   }}),
   (error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/CDP|frame|identity/i);
    assert.doesNotMatch(error.message,/PRIVATE_FRAME_DIAGNOSTIC_CANARY/,
     'raw CDP payload and provider exceptions must not escape');
    return true;
   },
  );
  assert.equal(socket?.listenerCount('message'),0,'release listeners on rejection');
 }
});
