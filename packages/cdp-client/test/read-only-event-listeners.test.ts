import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {inspectReadOnlyEventListeners} from '../src/read-only-event-listeners.ts';

const target={type:'page',id:'test-target',url:'https://example.test/a',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/test-target'};
const locator={method:'querySelector' as const,expression:'#action',runtimeRequired:false};
class FakeSocket extends EventEmitter {
 sent:{id:number;method:string;params:any}[]=[];
 private readonly steps:Record<string,(params:any)=>unknown>;
 constructor(steps:Record<string,(params:any)=>unknown>){super();this.steps=steps;queueMicrotask(()=>this.emit('open'));}
 addEventListener(name:string,fn:(event:any)=>void){this.on(name,fn);}
 removeEventListener(name:string,fn:(event:any)=>void){this.off(name,fn);}
 send(raw:string){
  const msg=JSON.parse(raw);this.sent.push(msg);
  queueMicrotask(()=>{
   let output:any;
   try{output={id:msg.id,result:this.steps[msg.method]?.(msg.params)??{}};}
   catch(e){output={id:msg.id,error:{message:String(e)}};}
   this.emit('message',{data:JSON.stringify(output)});
  });
 }
 close(){this.emit('close');}
}
function makeSocket(listeners:unknown=[{type:'click',useCapture:false,passive:true,once:false,scriptId:'SECRET',handler:{description:'SECRET SCRIPT SOURCE'}}],ids=[17]){
 return new FakeSocket({
  'DOM.getDocument':()=>({root:{nodeId:3}}),
  'DOM.querySelectorAll':()=>({nodeIds:ids}),
  'DOM.resolveNode':()=>({object:{type:'object',objectId:'remote-1'}}),
  'DOMDebugger.getEventListeners':()=>({listeners}),
  'Runtime.releaseObject':()=>({}),
 });
}
test('only direct listener metadata is summarized; no source, handler or CDP object id leaves the module',async()=>{
 const s=makeSocket();
 const got=await inspectReadOnlyEventListeners(target,locator,{socketFactory:()=>s});
 assert.deepEqual(got,{targetId:target.id,url:target.url,status:'registered',
  listenerCount:1,eventType:'click',validationLevel:'direct-event-listener-read-only',
  V2:'blocked',V3:'not-configured',V4:'not-configured',interactionVerified:false});
 assert.deepEqual(s.sent.map(x=>x.method),[
  'DOM.getDocument','DOM.querySelectorAll','DOM.resolveNode',
  'DOMDebugger.getEventListeners','Runtime.releaseObject',
 ]);
 assert.equal(JSON.stringify(got).includes('SECRET'),false);
 assert.equal(JSON.stringify(got).includes('remote-1'),false);
 assert.deepEqual(s.sent[3]?.params,{objectId:'remote-1',depth:0,pierce:false});
 assert.deepEqual(s.sent[4]?.params,{objectId:'remote-1'});
 assert.ok(!s.sent.some(x=>/^Input\.|^Page\.|^Runtime\.evaluate|^DOM\.set/.test(x.method)));
});
test('zero direct listeners does not mean a button has no functionality (delegation, inline handlers and bindings exist)',async()=>{
 const got=await inspectReadOnlyEventListeners(target,locator,{socketFactory:()=>makeSocket([])});
 assert.equal(got.status,'none-observed');
 assert.equal(got.listenerCount,0);
 assert.equal(got.V2,'blocked');
 assert.equal(got.interactionVerified,false);
});
test('missing and ambiguous locators never acquire remote JS objects',async()=>{
 for(const [ids,status] of [[[],'missing'],[[10,12],'ambiguous']] as const){
  const s=makeSocket([],ids as number[]);
  const got=await inspectReadOnlyEventListeners(target,locator,{socketFactory:()=>s});
  assert.equal(got.status,status);
  assert.equal(got.listenerCount,null);
  assert.deepEqual(s.sent.map(x=>x.method),['DOM.getDocument','DOM.querySelectorAll']);
 }
});
test('duplicate node ids, very large match lists and malformed listener lists are unknown, never pass',async()=>{
 for(const ids of [[10,10],Array.from({length:10001},(_,i)=>i+1)]){
  const s=makeSocket([],ids);
  const got=await inspectReadOnlyEventListeners(target,locator,{socketFactory:()=>s});
  assert.equal(got.status,'unknown');assert.equal(got.listenerCount,null);
  assert.deepEqual(s.sent.map(x=>x.method),['DOM.getDocument','DOM.querySelectorAll']);
 }
 for(const listeners of [null,'yes',Array(3000).fill({type:'click'}),[{type:7}]]){
  const got=await inspectReadOnlyEventListeners(target,locator,{socketFactory:()=>makeSocket(listeners)});
  assert.equal(got.status,'unknown');
  assert.equal(got.listenerCount,null);
  assert.equal(got.V2,'blocked');
 }
});
test('CDP listener errors fail closed and the remote handle is released',async()=>{
 const s=new FakeSocket({
  'DOM.getDocument':()=>({root:{nodeId:3}}),
  'DOM.querySelectorAll':()=>({nodeIds:[17]}),
  'DOM.resolveNode':()=>({object:{type:'object',objectId:'remote-1'}}),
  'DOMDebugger.getEventListeners':()=>{throw new Error('not supported');},
  'Runtime.releaseObject':()=>({}),
 });
 const got=await inspectReadOnlyEventListeners(target,locator,{socketFactory:()=>s});
 assert.equal(got.status,'unknown');
 assert.ok(s.sent.some(x=>x.method==='Runtime.releaseObject'));
});
test('reject dynamic selectors and external CDP sockets before any listener collection',async()=>{
 await assert.rejects(inspectReadOnlyEventListeners({...target,webSocketDebuggerUrl:'ws://evil.test/devtools/page/test-target'},locator),/loopback|CDP/i);
 await assert.rejects(inspectReadOnlyEventListeners(target,{...locator,runtimeRequired:true}),/literal|static/i);
 await assert.rejects(inspectReadOnlyEventListeners(target,{...locator,expression:''}),/selector|literal|static/i);
 await assert.rejects(inspectReadOnlyEventListeners(target,locator,{timeoutMs:60000}),/timeout|budget/i);
});

test('malformed remote DOM objects never enter event-listener inspection',async()=>{
 for(const object of [
  {type:'string',objectId:'remote-1'},
  {type:'function',objectId:'remote-1'},
  {type:'object',objectId:''},
  {type:'object',objectId:'remote-1',subtype:'null'},
 ]){
  const s=new FakeSocket({
   'DOM.getDocument':()=>({root:{nodeId:3}}),
   'DOM.querySelectorAll':()=>({nodeIds:[17]}),
   'DOM.resolveNode':()=>({object}),
   'DOMDebugger.getEventListeners':()=>{throw new Error('Must not inspect invalid object');},
  });
  const got=await inspectReadOnlyEventListeners(target,locator,{socketFactory:()=>s});
  assert.equal(got.status,'unknown');
  assert.equal(got.listenerCount,null);
  assert.deepEqual(s.sent.map(x=>x.method),['DOM.getDocument','DOM.querySelectorAll','DOM.resolveNode']);
 }
});
