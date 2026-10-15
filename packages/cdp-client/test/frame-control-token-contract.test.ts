import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {assertStablePageDocument,confirmPageIdentity} from '../src/page-identity.ts';

const target={
 type:'page',id:'rg01-control-fixture',url:'https://example.test/root',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/rg01-control-fixture',
};

class FrameTokenSocket extends EventEmitter{
 private readonly mainId:string;
 private readonly childId:string;
 constructor(mainId:string,childId:string){
  super();
  this.mainId=mainId;
  this.childId=childId;
  queueMicrotask(()=>this.emit('open'));
 }
 addEventListener(name:string,callback:(event:any)=>void){this.on(name,callback);}
 removeEventListener(name:string,callback:(event:any)=>void){this.off(name,callback);}
 send(message:string){
  const {id}=JSON.parse(message);
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({
   id,result:{frameTree:{
    frame:{id:this.mainId,loaderId:'loader-main',url:target.url},
    childFrames:[{frame:{id:this.childId,loaderId:'loader-child',url:'https://example.test/child'}}],
   }},
  })}));
 }
 close(){this.emit('close');}
}

test('RG-01 rejects whitespace-only or control-bearing nested CDP frame IDs',async()=>{
 for(const childId of ['  ','child\\nid'.replace('\\n','\n'),'child\u0000id']){
  const socket=new FrameTokenSocket('legitimate-main',childId);
  await assert.rejects(
   confirmPageIdentity(target,{socketFactory:()=>socket}),
   /Invalid nested CDP frame tree/,
   'hostile child identity must not authorize a trusted same-origin subframe',
  );
  assert.equal(socket.listenerCount('message'),0);
 }
});

test('RG-01 rejects control-bearing top-level CDP frame IDs',async()=>{
 for(const mainId of [' \t ','root\u0000id']){
  const socket=new FrameTokenSocket(mainId,'legitimate-child');
  await assert.rejects(
   confirmPageIdentity(target,{socketFactory:()=>socket}),
   /Invalid nested CDP frame tree|Invalid main-frame document identity token/,
  );
  assert.equal(socket.listenerCount('message'),0);
 }
});

test('RG-01 stable document fence rejects invalid pinned identity tokens even when matching',()=>{
 const valid={targetId:target.id,confirmedUrl:target.url,frameId:'root',loaderId:'loader'};
 assert.doesNotThrow(()=>assertStablePageDocument(valid,valid));
 for(const bad of [
  {...valid,frameId:' \t '},
  {...valid,loaderId:'loader\u0000spoof'},
 ]){
  assert.throws(()=>assertStablePageDocument(bad,bad),/document identity unavailable/i);
 }
});
