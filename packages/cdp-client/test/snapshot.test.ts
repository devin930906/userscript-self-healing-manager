import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {captureDomSummary} from '../src/snapshot.ts';
class FakeSocket extends EventEmitter{
 sent:string[]=[];
 private readonly payload:unknown;
 constructor(payload:unknown){super();this.payload=payload;queueMicrotask(()=>this.emit('open'));}
 send(raw:string){this.sent.push(raw);const msg=JSON.parse(raw);queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:msg.id,result:this.payload})}));}
 close(){this.emit('close');}
 addEventListener(type:string,fn:(value:any)=>void){this.on(type,fn);}
 removeEventListener(type:string,fn:(value:any)=>void){this.off(type,fn);}
}
const target={id:'p1',type:'page',url:'https://example.com/',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/p1'};
test('DOMSnapshot counts evidence without returning private page text',async()=>{
 const socket=new FakeSocket({strings:['private password','secret'],documents:[{nodes:{nodeName:[0,1,2]}},{nodes:{nodeName:[0]}}]});
 const result=await captureDomSummary(target,{socketFactory:()=>socket as any});
 assert.deepEqual(result,{targetId:'p1',url:'https://example.com/',documentCount:2,nodeCount:4,authorShadowTreeNodes:0,validationLevel:'evidence-only'});
 assert.equal(JSON.parse(socket.sent[0]!).method,'DOMSnapshot.captureSnapshot');
 assert.ok(!JSON.stringify(result).includes('secret'));
});
test('DOMSnapshot rejects untrusted socket locations',async()=>{
 await assert.rejects(captureDomSummary({...target,webSocketDebuggerUrl:'ws://evil.test/devtools/page/p1'}),/loopback/);
 await assert.rejects(captureDomSummary({...target,webSocketDebuggerUrl:'ws://127.0.0.1:9223/other/path'}),/target/);
});
test('DOMSnapshot cannot falsely pass malformed responses',async()=>{
 await assert.rejects(captureDomSummary(target,{socketFactory:()=>new FakeSocket({documents:[]}) as any}),/snapshot/);
});

test('DOM summary refuses redirect to unrelated loopback debugger ports',async()=>{
 await assert.rejects(captureDomSummary({...target,webSocketDebuggerUrl:'ws://127.0.0.1:9224/devtools/page/p1'}),/port/i);
});

test('DOM summary rejects excessive frame and node counts before returning misleading evidence',async()=>{
 const frames=Array.from({length:65},()=>({nodes:{nodeName:[0]}}));
 await assert.rejects(captureDomSummary(target,{socketFactory:()=>new FakeSocket({documents:frames}) as any}),/limit|count/i);
 const huge={documents:[{nodes:{nodeName:Array.from({length:200001},()=>0)}}]};
 await assert.rejects(captureDomSummary(target,{socketFactory:()=>new FakeSocket(huge) as any}),/limit|count/i);
});
test('author Shadow DOM detection distinguishes open/closed roots from browser user-agent nodes',async()=>{
 const socket=new FakeSocket({
  strings:['open','closed','user-agent','private shadow text'],
  documents:[{nodes:{nodeName:[0,0,0,0],shadowRootType:{index:[0,1,2],value:[0,1,2]}}}],
 });
 const result=await captureDomSummary(target,{socketFactory:()=>socket as any});
 assert.equal(result.authorShadowTreeNodes,2);
 assert.doesNotMatch(JSON.stringify(result),/private shadow text|closed|user-agent/);
});
test('malformed Shadow DOM rare-string indexes fail closed',async()=>{
 const socket=new FakeSocket({
  strings:['open'],
  documents:[{nodes:{nodeName:[0],shadowRootType:{index:[99],value:[0]}}}],
 });
 await assert.rejects(captureDomSummary(target,{socketFactory:()=>socket as any}),/shadow|invalid|range/i);
});
