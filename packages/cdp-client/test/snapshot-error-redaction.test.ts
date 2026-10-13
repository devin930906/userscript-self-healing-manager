import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {captureDomSummary} from '../src/snapshot.ts';

const target={
 id:'dom-synthetic',type:'page',url:'https://fixture.example.invalid/editor',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/dom-synthetic',
};
const secret='PRIVATE_DOM_SNAPSHOT_CANARY';
class SyntheticSnapshotSocket extends EventEmitter{
 readonly mode:'invalid-json'|'send-failure';
 constructor(mode:SyntheticSnapshotSocket['mode']){
  super();this.mode=mode;queueMicrotask(()=>this.emit('open'));
 }
 addEventListener(name:string,callback:(event:any)=>void){this.on(name,callback);}
 removeEventListener(name:string,callback:(event:any)=>void){this.off(name,callback);}
 send(raw:string){
  if(this.mode==='send-failure')throw new Error('Untrusted transport: '+secret);
  const id=JSON.parse(raw).id;
  queueMicrotask(()=>this.emit('message',{data:secret+'-not-json',id}));
 }
 close(){this.emit('close');}
}

test('RG-07 DOM snapshot rejects invalid JSON or transport failure without echoing untrusted text',async()=>{
 for(const mode of ['invalid-json','send-failure'] as const){
  let socket:SyntheticSnapshotSocket|undefined;
  await assert.rejects(captureDomSummary(target,{socketFactory:()=>{
   socket=new SyntheticSnapshotSocket(mode);
   return socket;
  }}),error=>{
   assert.ok(error instanceof Error);
   assert.match(error.message,/CDP|DOM|snapshot/i);
   assert.doesNotMatch(error.message,/PRIVATE_DOM_SNAPSHOT_CANARY/);
   return true;
  });
  assert.equal(socket?.listenerCount('message'),0);
 }
});
