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
 assert.deepEqual(result,{targetId:'p1',url:'https://example.com/',documentCount:2,nodeCount:4,validationLevel:'evidence-only'});
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
