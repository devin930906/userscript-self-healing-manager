import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {inspectReadOnlyEventListeners} from '../src/read-only-event-listeners.ts';

const target={id:'synthetic-page',type:'page',url:'https://fixture.example.invalid/',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/synthetic-page'};
const locator={method:'querySelector',expression:'#submit',runtimeRequired:false};
class MalformedEventListenerSocket extends EventEmitter{
 constructor(){super();queueMicrotask(()=>this.emit('open'));}
 addEventListener(name:string,listener:(event:any)=>void){this.on(name,listener);}
 removeEventListener(name:string,listener:(event:any)=>void){this.off(name,listener);}
 send(_command:string){queueMicrotask(()=>this.emit('message',{data:'PRIVATE42'}));}
 close(){this.emit('close');}
}

test('RG-07 read-only listener response rejects private parser payloads without V2 escalation',async()=>{
 const socket=new MalformedEventListenerSocket();
 await assert.rejects(inspectReadOnlyEventListeners(target,locator,{socketFactory:()=>socket}),error=>{
  assert.ok(error instanceof Error);
  assert.match(error.message,/CDP|listener/i);
  assert.doesNotMatch(error.message,/PRIVATE42/);
  return true;
 });
 assert.equal(socket.listenerCount('message'),0,'discard listeners after malformed response');
});

test('RG-07 passive listener evidence from a valid empty response never claims V2/V3/V4',async()=>{
 const socket=new (class extends EventEmitter{
  constructor(){super();queueMicrotask(()=>this.emit('open'));}
  addEventListener(name:string,cb:(e:any)=>void){this.on(name,cb);}
  removeEventListener(name:string,cb:(e:any)=>void){this.off(name,cb);}
  send(command:string){const request=JSON.parse(command);queueMicrotask(()=>this.emit('message',{
   data:JSON.stringify({id:request.id,result:request.method==='DOM.getDocument'?
    {root:{nodeId:1}}:{nodeIds:[]}}),
  }));}
  close(){this.emit('close');}
 })();
 const report=await inspectReadOnlyEventListeners(target,locator,{socketFactory:()=>socket});
 assert.equal(report.status,'missing');
 assert.equal(report.V2,'blocked');
 assert.equal(report.V3,'not-configured');
 assert.equal(report.V4,'not-configured');
 assert.equal(report.interactionVerified,false);
});
