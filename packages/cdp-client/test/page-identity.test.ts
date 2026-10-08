import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {confirmPageIdentity} from '../src/page-identity.ts';

class FakeSocket extends EventEmitter {
 readonly sent:Array<{id:number;method:string}>=[];
 private readonly pageUrl:string|null;
 constructor(pageUrl:string|null) {super();this.pageUrl=pageUrl;queueMicrotask(()=>this.emit('open'));}
 addEventListener(name:string,listener:(event:any)=>void){this.on(name,listener);}
 removeEventListener(name:string,listener:(event:any)=>void){this.off(name,listener);}
 send(body:string) {
  const q=JSON.parse(body);this.sent.push(q);
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:q.id,result:this.pageUrl===null?{}:{frameTree:{frame:{url:this.pageUrl,id:'frame1'}}}})}));
 }
 close(){this.emit('close');}
}
const page={type:'page',id:'alpha',url:'https://example.test/path?x=1',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/alpha'};

test('checks actual top-frame URL using read-only Page.getFrameTree, not stale /json/list identity',async()=>{
 const socket=new FakeSocket(page.url);
 const result=await confirmPageIdentity(page,{socketFactory:()=>socket});
 assert.deepEqual(result,{targetId:'alpha',confirmedUrl:page.url});
 assert.deepEqual(socket.sent.map(x=>x.method),['Page.getFrameTree']);
});

test('page navigation during DOM inspection is rejected rather than using a mismatched page',async()=>{
 await assert.rejects(confirmPageIdentity(page,{socketFactory:()=>new FakeSocket('https://other.example/account')}),/page.*(changed|mismatch)/i);
 await assert.rejects(confirmPageIdentity(page,{socketFactory:()=>new FakeSocket(null)}),/frame tree|frame URL/i);
});

test('frame identity probes deny cross-port websocket targets',async()=>{
 await assert.rejects(confirmPageIdentity({...page,webSocketDebuggerUrl:'ws://127.0.0.1:9224/devtools/page/alpha'}),/port/i);
});

test('read-only frame identity counts nested browsing contexts without revealing child URLs',async()=>{
 const socket=new (class extends EventEmitter{
  addEventListener(name:string,listener:(e:any)=>void){this.on(name,listener);}
  removeEventListener(name:string,listener:(e:any)=>void){this.off(name,listener);}
  constructor(){super();queueMicrotask(()=>this.emit('open'));}
  send(data:string){const command=JSON.parse(data);queueMicrotask(()=>this.emit('message',{data:JSON.stringify({
   id:command.id,result:{frameTree:{frame:{id:'root',url:page.url},childFrames:[
    {frame:{id:'a',url:'https://private.test/secret'}},
    {frame:{id:'b',url:'about:srcdoc'},childFrames:[{frame:{id:'c',url:'about:blank'}}]},
   ]}},
  })}));}
  close(){this.emit('close');}
 })();
 const result=await confirmPageIdentity(page,{socketFactory:()=>socket});
 assert.equal(result.subframeCount,3);
 assert.equal(result.confirmedUrl,page.url);
 assert.doesNotMatch(JSON.stringify(result),/private\\.test|srcdoc/);
});
test('frame identity fails closed if nested frame tree exceeds the inspection budget',async()=>{
 const socket=new (class extends EventEmitter{
  addEventListener(name:string,listener:(e:any)=>void){this.on(name,listener);}
  removeEventListener(name:string,listener:(e:any)=>void){this.off(name,listener);}
  constructor(){super();queueMicrotask(()=>this.emit('open'));}
  send(data:string){const command=JSON.parse(data);queueMicrotask(()=>this.emit('message',{data:JSON.stringify({
   id:command.id,result:{frameTree:{frame:{id:'root',url:page.url},
    childFrames:Array.from({length:65},(_,i)=>({frame:{id:'child-'+i,url:'about:blank'}}))}},
  })}));}
  close(){this.emit('close');}
 })();
 await assert.rejects(confirmPageIdentity(page,{socketFactory:()=>socket}),/frame.*limit|too many/i);
});
