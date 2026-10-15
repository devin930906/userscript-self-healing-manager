import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {confirmPageIdentity} from '../src/page-identity.ts';

const target={
 type:'page',id:'rg01-nested-fixture',url:'https://example.test/page',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/rg01-nested-fixture',
};

class NestedIdentitySocket extends EventEmitter {
 constructor(private readonly childId:string) {
  super();
  queueMicrotask(()=>this.emit('open'));
 }
 addEventListener(name:string,callback:(event:any)=>void){this.on(name,callback);}
 removeEventListener(name:string,callback:(event:any)=>void){this.off(name,callback);}
 send(message:string){
  const {id}=JSON.parse(message);
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({
   id,result:{frameTree:{
    frame:{id:'legitimate-top',loaderId:'top-loader',url:target.url},
    childFrames:[{frame:{
     id:this.childId,loaderId:'child-loader',url:'https://example.test/child?private=DO_NOT_LOG',
    }}],
   }},
  })}));
 }
 close(){this.emit('close');}
}

test('RG-01 rejects malformed nested frame identity before trusting its document tree',async()=>{
 for(const childId of ['', 'x'.repeat(257)]){
  const socket=new NestedIdentitySocket(childId);
  await assert.rejects(
   confirmPageIdentity(target,{socketFactory:()=>socket}),
   /Invalid nested CDP frame tree/,
   'a missing or over-budget child identity must not produce a trusted page receipt',
  );
  assert.equal(socket.listenerCount('message'),0,
   'invalid CDP frame tree responses must release WebSocket listeners');
 }
});

test('RG-01 still accepts a valid pinned single same-origin child',async()=>{
 const socket=new NestedIdentitySocket('legitimate-child');
 const receipt=await confirmPageIdentity(target,{socketFactory:()=>socket});
 assert.equal(receipt.frameId,'legitimate-top');
 assert.equal(receipt.loaderId,'top-loader');
 assert.equal(receipt.subframeCount,1);
 assert.equal(receipt.soleSameOriginSubframe?.frameId,'legitimate-child');
 assert.equal(receipt.soleSameOriginSubframe?.loaderId,'child-loader');
 assert.doesNotMatch(JSON.stringify(receipt),/DO_NOT_LOG|\/child\?/);
 assert.equal(socket.listenerCount('message'),0);
});
