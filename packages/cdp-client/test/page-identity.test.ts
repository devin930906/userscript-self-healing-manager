import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {confirmPageIdentity,assertStablePageDocument} from '../src/page-identity.ts';

class FakeSocket extends EventEmitter {
 readonly sent:Array<{id:number;method:string}>=[];
 private readonly pageUrl:string|null;
 private readonly includeLoader:boolean;
 constructor(pageUrl:string|null,includeLoader=true) {super();this.pageUrl=pageUrl;this.includeLoader=includeLoader;queueMicrotask(()=>this.emit('open'));}
 addEventListener(name:string,listener:(event:any)=>void){this.on(name,listener);}
 removeEventListener(name:string,listener:(event:any)=>void){this.off(name,listener);}
 send(body:string) {
  const q=JSON.parse(body);this.sent.push(q);
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:q.id,result:this.pageUrl===null?{}:{frameTree:{frame:{url:this.pageUrl,id:'frame1',...(this.includeLoader?{loaderId:'stable-loader'}:{})}}}})}));
 }
 close(){this.emit('close');}
}
const page={type:'page',id:'alpha',url:'https://example.test/path?x=1',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/alpha'};

test('checks actual top-frame URL using read-only Page.getFrameTree, not stale /json/list identity',async()=>{
 const socket=new FakeSocket(page.url);
 const result=await confirmPageIdentity(page,{socketFactory:()=>socket});
 assert.deepEqual(result,{targetId:'alpha',confirmedUrl:page.url,frameId:'frame1',loaderId:'stable-loader'});
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
   id:command.id,result:{frameTree:{frame:{id:'root',loaderId:'root-loader',url:page.url},childFrames:[
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
   id:command.id,result:{frameTree:{frame:{id:'root',loaderId:'root-loader',url:page.url},
    childFrames:Array.from({length:65},(_,i)=>({frame:{id:'child-'+i,url:'about:blank'}}))}},
  })}));}
  close(){this.emit('close');}
 })();
 await assert.rejects(confirmPageIdentity(page,{socketFactory:()=>socket}),/frame.*limit|too many/i);
});

test('rejects a same-URL navigation when the main-frame document loader changes',()=>{
 const previous={targetId:page.id,confirmedUrl:page.url,frameId:'root',loaderId:'loader-before'};
 assert.throws(()=>assertStablePageDocument(previous,{...previous,loaderId:'loader-after'}),/document|loader|navigation|identity/i);
 assert.throws(()=>assertStablePageDocument(previous,{...previous,frameId:'different-root'}),/document|frame|identity/i);
 assert.doesNotThrow(()=>assertStablePageDocument(previous,{...previous}));
});
test('reads stable loader identity from Page.getFrameTree without collecting frame contents',async()=>{
 const socket=new (class extends EventEmitter{
  constructor(){super();queueMicrotask(()=>this.emit('open'));}
  addEventListener(name:string,listener:(e:any)=>void){this.on(name,listener);}
  removeEventListener(name:string,listener:(e:any)=>void){this.off(name,listener);}
  send(message:string){const q=JSON.parse(message);queueMicrotask(()=>this.emit('message',{data:JSON.stringify({
   id:q.id,result:{frameTree:{frame:{id:'root',loaderId:'loader-current',url:page.url}}},
  })}));}
  close(){this.emit('close');}
 })();
 const result=await confirmPageIdentity(page,{socketFactory:()=>socket});
 assert.equal(result.frameId,'root');
 assert.equal(result.loaderId,'loader-current');
 assert.equal(result.confirmedUrl,page.url);
});

test('a frame with no loader ID is not trustworthy enough for DOM evidence',async()=>{
 await assert.rejects(
  confirmPageIdentity(page,{socketFactory:()=>new FakeSocket(page.url,false)}),
  /loader|document identity/i
 );
});

test('single same-origin child document exposes bounded frame/loader identity without child URL',async()=>{
 const socket=new (class extends EventEmitter{
  constructor(){super();queueMicrotask(()=>this.emit('open'))}
  addEventListener(name:string,cb:(x:any)=>void){this.on(name,cb)}
  removeEventListener(name:string,cb:(x:any)=>void){this.off(name,cb)}
  send(data:string){const m=JSON.parse(data);queueMicrotask(()=>this.emit('message',{data:JSON.stringify({
   id:m.id,result:{frameTree:{frame:{id:'top',loaderId:'top-load',url:page.url},
    childFrames:[{frame:{id:'child-a',loaderId:'child-load',url:'https://example.test/child?secret=test-value'}}]}},
  })}))}
  close(){this.emit('close')}
 })();
 const result=await confirmPageIdentity(page,{socketFactory:()=>socket});
 assert.equal(result.subframeCount,1);
 assert.deepEqual(result.soleSameOriginSubframe,{frameId:'child-a',loaderId:'child-load'});
 assert.doesNotMatch(JSON.stringify(result),/secret|child\?/);
 assert.doesNotThrow(()=>assertStablePageDocument(result,{...result}));
 assert.throws(()=>assertStablePageDocument(result,{
  ...result,soleSameOriginSubframe:{frameId:'child-a',loaderId:'another-loader'},
 }),/frame|loader|identity|navigation/i);
});
test('cross-origin, multiple or missing-loader subframes never receive trusted in-process child identity',async()=>{
 const variants=[
  [{id:'foreign',loaderId:'load',url:'https://other.test/' }],
  [{id:'one',loaderId:'a',url:'https://example.test/a'},{id:'two',loaderId:'b',url:'https://example.test/b'}],
  [{id:'without-loader',url:'https://example.test/a'}],
 ];
 for(const frames of variants){
  const socket=new (class extends EventEmitter{
   constructor(){super();queueMicrotask(()=>this.emit('open'))}
   addEventListener(name:string,cb:(x:any)=>void){this.on(name,cb)}
   removeEventListener(name:string,cb:(x:any)=>void){this.off(name,cb)}
   send(data:string){const m=JSON.parse(data);queueMicrotask(()=>this.emit('message',{data:JSON.stringify({
    id:m.id,result:{frameTree:{frame:{id:'top',loaderId:'top-load',url:page.url},
     childFrames:frames.map(frame=>({frame}))}},
   })}))}
   close(){this.emit('close')}
  })();
  const got=await confirmPageIdentity(page,{socketFactory:()=>socket});
  assert.equal(got.soleSameOriginSubframe,undefined);
 }
});

test('same-loader iframe SPA navigation invalidates evidence without exposing the private child URL',async()=>{
 let childUrl='https://example.test/account?private=ALPHA_TOKEN';
 const socketFactory=()=>new (class extends EventEmitter{
  constructor(){super();queueMicrotask(()=>this.emit('open'));}
  addEventListener(name:string,cb:(x:any)=>void){this.on(name,cb);}
  removeEventListener(name:string,cb:(x:any)=>void){this.off(name,cb);}
  send(message:string){
   const q=JSON.parse(message);
   queueMicrotask(()=>this.emit('message',{data:JSON.stringify({
    id:q.id,result:{frameTree:{frame:{id:'top',loaderId:'top-load',url:page.url},
     childFrames:[{frame:{id:'child',loaderId:'unchanged-loader',url:childUrl}}]}},
   })}));
  }
  close(){this.emit('close');}
 })();
 const before=await confirmPageIdentity(page,{socketFactory});
 childUrl='https://example.test/settings?private=BETA_TOKEN';
 const after=await confirmPageIdentity(page,{socketFactory});
 assert.equal(before.soleSameOriginSubframe?.frameId,'child');
 assert.equal(before.soleSameOriginSubframe?.loaderId,'unchanged-loader');
 assert.equal(after.soleSameOriginSubframe?.loaderId,'unchanged-loader');
 assert.match(before.soleSameOriginSubframe?.urlFingerprint??'',/^[a-f0-9]{64}$/);
 assert.match(after.soleSameOriginSubframe?.urlFingerprint??'',/^[a-f0-9]{64}$/);
 assert.notEqual(before.soleSameOriginSubframe?.urlFingerprint,after.soleSameOriginSubframe?.urlFingerprint);
 assert.doesNotMatch(JSON.stringify([before,after]),/ALPHA_TOKEN|BETA_TOKEN|\/account|\/settings/);
 assert.throws(()=>assertStablePageDocument(before,after),/document|navigation|frame|identity/i);
});
