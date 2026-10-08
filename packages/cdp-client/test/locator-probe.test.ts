import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {probePageLocators} from '../src/locator-probe.ts';
class ProtocolSocket extends EventEmitter{
 readonly sent:Array<{id:number;method:string;params:any}>=[];
 private readonly handlers:Record<string,(params:any)=>any>;
 constructor(handlers:Record<string,(params:any)=>any>){super();this.handlers=handlers;queueMicrotask(()=>this.emit('open'));}
 addEventListener(event:string,handler:(value:any)=>void){this.on(event,handler);}
 removeEventListener(event:string,handler:(value:any)=>void){this.off(event,handler);}
 send(input:string){const message=JSON.parse(input);this.sent.push(message);queueMicrotask(()=>{let response:any;try{response={id:message.id,result:this.handlers[message.method]?.(message.params)??{}};}catch(error){response={id:message.id,error:{message:String(error)}};}this.emit('message',{data:JSON.stringify(response)});});}
 close(){this.emit('close');}
}
const page={type:'page',id:'alpha',url:'https://site.example/page',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/alpha'};
test('read-only CDP selectors return match counts and no raw text',async()=>{
 const socket=new ProtocolSocket({'DOM.getDocument':()=>({root:{nodeId:8}}),'DOM.querySelectorAll':({selector})=>({nodeIds:selector==='#save'?[31]:[]})});
 const result=await probePageLocators(page,[{method:'querySelector',expression:'#save',runtimeRequired:false},{method:'querySelectorAll',expression:'.deleted',runtimeRequired:false}],{socketFactory:()=>socket});
 assert.deepEqual(result.checks.map(x=>x.status),['found','missing']);
 assert.deepEqual(result.checks.map(x=>x.matchCount),[1,0]);
 assert.equal(result.validationLevel,'dom-only');
 assert.deepEqual(socket.sent.map(s=>s.method),['DOM.getDocument','DOM.querySelectorAll','DOM.querySelectorAll']);
 assert.equal(JSON.stringify(result).includes('nodeIds'),false);
});
test('dynamic and context-dependent selectors are unverified',async()=>{
 const socket=new ProtocolSocket({'DOM.getDocument':()=>({root:{nodeId:1}}),'DOM.querySelectorAll':()=>({nodeIds:[1]})});
 const result=await probePageLocators(page,[{method:'querySelector',expression:'dynamic-template',runtimeRequired:true},{method:'closest',expression:'.card',runtimeRequired:false},{method:'getElementById',expression:'buy now',runtimeRequired:false}],{socketFactory:()=>socket});
 assert.deepEqual(result.checks.map(x=>x.status),['unverified','unverified','found']);
 assert.equal(socket.sent[1]?.params.selector,'#buy\\ now');
});
test('invalid CSS is blocked, multiple element matches are ambiguous',async()=>{
 const socket=new ProtocolSocket({'DOM.getDocument':()=>({root:{nodeId:1}}),'DOM.querySelectorAll':({selector})=>{if(selector==='[')throw new Error('invalid CSS');return {nodeIds:[1,2]};}});
 const result=await probePageLocators(page,[{method:'querySelector',expression:'[',runtimeRequired:false},{method:'querySelector',expression:'.both',runtimeRequired:false}],{socketFactory:()=>socket});
 assert.deepEqual(result.checks.map(x=>x.status),['blocked','ambiguous']);
});
test('CDP probes reject external websockets, mismatched targets and unbounded batches',async()=>{
 await assert.rejects(probePageLocators({...page,webSocketDebuggerUrl:'ws://example.com/devtools/page/alpha'},[]),/loopback/);
 await assert.rejects(probePageLocators({...page,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/other'},[]),/target/);
 await assert.rejects(probePageLocators(page,Array.from({length:51},()=>({method:'querySelector',expression:'x',runtimeRequired:false}))),/Too many/);
});
test('invalid CDP document root is rejected',async()=>{
 const socket=new ProtocolSocket({'DOM.getDocument':()=>({root:{nodeId:0}})});
 await assert.rejects(probePageLocators(page,[{method:'querySelector',expression:'div',runtimeRequired:false}],{socketFactory:()=>socket}),/document root/);
});

test('page locator checks refuse a different local debugger port',async()=>{
 await assert.rejects(probePageLocators({...page,webSocketDebuggerUrl:'ws://127.0.0.1:9224/devtools/page/alpha'},[{method:'querySelector',expression:'div',runtimeRequired:false}]),/port/i);
});
