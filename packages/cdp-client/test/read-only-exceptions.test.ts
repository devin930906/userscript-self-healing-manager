import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {observeReadOnlyPageExceptions} from '../src/read-only-exceptions.ts';

const target={
 type:'page',id:'exception-page',url:'https://fixture.example.test/app?private=SECRET_QUERY',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/exception-page',
};
const confirmed=()=>({
 targetId:target.id,confirmedUrl:target.url,frameId:'main-frame',loaderId:'original-loader',
});
const exception=(id:number)=>({
 method:'Runtime.exceptionThrown',
 params:{exceptionDetails:{
  exceptionId:id,text:'LEAK_ME',
  url:'https://private.example.test/token=LEAK_ME',
  exception:{description:'LEAK_ME'},
  stackTrace:{callFrames:[{url:'file:///C:/Users/Secret/LEAK_ME.user.js'}]},
 }},
});
class FakeSocket extends EventEmitter {
 readonly sent:Array<{id:number;method:string}>=[];
 closed=0;
 private readonly events:readonly unknown[];
 private readonly ack:boolean;
 constructor(events:readonly unknown[]=[],ack=true){
  super();this.events=events;this.ack=ack;
 }
 addEventListener(name:string,listener:(e:any)=>void){this.on(name,listener);}
 removeEventListener(name:string,listener:(e:any)=>void){this.off(name,listener);}
 send(payload:string){
  const message=JSON.parse(payload) as {id:number;method:string};
  this.sent.push(message);
  queueMicrotask(()=>{
   this.emit('message',{data:JSON.stringify(this.ack?
    {id:message.id,result:{}}:{id:message.id,error:{message:'LEAK_ME'}})});
   if(message.method==='Runtime.enable'&&this.ack)
    for(const event of this.events)
     this.emit('message',{data:JSON.stringify(event)});
  });
 }
 close(){this.closed++;this.emit('close');}
}

test('FR-018 passive observer counts only bounded exception IDs, never exports URLs, stack or raw text',async()=>{
 const socket=new FakeSocket([exception(1),exception(2),exception(1)]);
 let identities=0;
 const out=await observeReadOnlyPageExceptions(target,{
  approved:true,durationMs:100,
  confirm:async()=>{identities++;return confirmed();},
  socketFactory:()=>{queueMicrotask(()=>socket.emit('open'));return socket;},
 });
 assert.equal(identities,2);
 assert.deepEqual(out,{
  targetId:target.id,status:'observed',observedCount:2,
  validationLevel:'runtime-exception-count-only',
  origin:'unknown',attribution:'unattributed',userscriptVerified:false,
  V2:'blocked',V3:'not-configured',V4:'not-configured',
 });
 assert.deepEqual(socket.sent.map(x=>x.method),['Runtime.enable','Runtime.disable']);
 assert.equal(socket.closed,1);
 assert.doesNotMatch(JSON.stringify(out),/LEAK_ME|SECRET_QUERY|private\.example|file:\/\/|Users/);
});

test('FR-018 zero events is none-observed only, never a functional or manager pass',async()=>{
 const socket=new FakeSocket();
 const out=await observeReadOnlyPageExceptions(target,{
  approved:true,durationMs:100,confirm:async()=>confirmed(),socketFactory:()=>{queueMicrotask(()=>socket.emit('open'));return socket;},
 });
 assert.equal(out.status,'none-observed');
 assert.equal(out.observedCount,0);
 assert.equal(out.userscriptVerified,false);
 assert.equal(out.V3,'not-configured');
 assert.equal(out.V4,'not-configured');
 assert.deepEqual(socket.sent.map(x=>x.method),['Runtime.enable','Runtime.disable']);
});

test('FR-018 malformed event metadata or exceeded event budget fails closed with no partial count',async()=>{
 for(const events of [
  [{method:'Runtime.exceptionThrown',params:{exceptionDetails:{exceptionId:'LEAK_ME'}}}],
  Array.from({length:65},(_,i)=>exception(i+1)),
 ]){
  const socket=new FakeSocket(events);
  const out=await observeReadOnlyPageExceptions(target,{
   approved:true,durationMs:100,confirm:async()=>confirmed(),socketFactory:()=>{queueMicrotask(()=>socket.emit('open'));return socket;},
  });
  assert.equal(out.status,'unknown');
  assert.equal(out.observedCount,null);
  assert.deepEqual(socket.sent.map(x=>x.method),['Runtime.enable','Runtime.disable']);
  assert.doesNotMatch(JSON.stringify(out),/LEAK_ME|private\.example/);
 }
});

test('FR-018 unauthorized, remote and invalid observation parameters are rejected before CDP sockets',async()=>{
 let attempts=0;
 const settings={
  durationMs:100,
  confirm:async()=>{attempts++;return confirmed();},
  socketFactory:()=>{attempts++;return new FakeSocket();},
 };
 await assert.rejects(observeReadOnlyPageExceptions(target,{...settings,approved:false}),/approval|consent|authoriz/i);
 await assert.rejects(observeReadOnlyPageExceptions({...target,webSocketDebuggerUrl:'ws://malicious.example:9223/devtools/page/exception-page'},
  {...settings,approved:true}),/loopback/i);
 await assert.rejects(observeReadOnlyPageExceptions(target,{...settings,approved:true,durationMs:10000}),/duration|budget/i);
 assert.equal(attempts,0);
});

test('FR-018 same-URL reload invalidates counted exceptions rather than attributing stale evidence',async()=>{
 let count=0;
 const socket=new FakeSocket([exception(10)]);
 await assert.rejects(observeReadOnlyPageExceptions(target,{
  approved:true,durationMs:100,socketFactory:()=>{queueMicrotask(()=>socket.emit('open'));return socket;},
  confirm:async()=>{count++;return {...confirmed(),loaderId:count===1?'original-loader':'new-loader'};},
 }),/identity|document|loader|navigation/i);
 assert.equal(count,2);
 assert.equal(socket.closed,1);
});

test('FR-018 runtime enable denial never leaks Chrome exception text or declares false zero',async()=>{
 const socket=new FakeSocket([],false);
 await assert.rejects(observeReadOnlyPageExceptions(target,{
  approved:true,durationMs:100,confirm:async()=>confirmed(),socketFactory:()=>{queueMicrotask(()=>socket.emit('open'));return socket;},
 }),/runtime|CDP|observe/i);
 assert.equal(socket.closed,1);
 assert.deepEqual(socket.sent.map(x=>x.method),['Runtime.enable']);
});

test('FR-018 execution context clearing invalidates otherwise zero-count exception observation',async()=>{
 for(const method of ['Runtime.executionContextsCleared','Runtime.executionContextDestroyed']){
  const socket=new FakeSocket([{method,...(method.endsWith('Destroyed')?{params:{executionContextId:3}}:{})}]);
  const out=await observeReadOnlyPageExceptions(target,{
   approved:true,durationMs:100,confirm:async()=>confirmed(),
   socketFactory:()=>{queueMicrotask(()=>socket.emit('open'));return socket;},
  });
  assert.equal(out.status,'unknown',method);
  assert.equal(out.observedCount,null,method);
  assert.equal(out.origin,'unknown');
  assert.equal(out.V3,'not-configured');
  assert.equal(out.V4,'not-configured');
  assert.deepEqual(socket.sent.map(x=>x.method),['Runtime.enable','Runtime.disable']);
 }
});

/**
 * Chrome may emit Runtime events while Runtime.enable is in flight.
 * A zero exception count is not justified if an exception/context reset
 * preceded the enable acknowledgement.
 */
test('FR-018 refuses a false zero when exception or context reset precedes Runtime.enable ack',async()=>{
 for(const early of [
  exception(42),
  {method:'Runtime.executionContextsCleared'},
  {method:'Runtime.executionContextDestroyed',params:{executionContextId:17}},
 ]){
  class PreAckSocket extends FakeSocket{
   override send(payload:string){
    if((JSON.parse(payload) as {method:string}).method==='Runtime.enable')
     queueMicrotask(()=>this.emit('message',{data:JSON.stringify(early)}));
    super.send(payload);
   }
  }
  const socket=new PreAckSocket();
  const out=await observeReadOnlyPageExceptions(target,{
   approved:true,durationMs:100,confirm:async()=>confirmed(),
   socketFactory:()=>{queueMicrotask(()=>socket.emit('open'));return socket;},
  });
  assert.equal(out.status,'unknown',early.method);
  assert.equal(out.observedCount,null,early.method);
  assert.equal(out.userscriptVerified,false);
  assert.deepEqual(socket.sent.map(x=>x.method),['Runtime.enable','Runtime.disable']);
  assert.doesNotMatch(JSON.stringify(out),/LEAK_ME|private\.example|SECRET_QUERY/);
 }
});
