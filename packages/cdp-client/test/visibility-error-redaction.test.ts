import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {inspectReadOnlyElementVisibility} from '../src/read-only-visibility.ts';

const target={id:'synthetic',type:'page',url:'https://fixture.example.invalid/',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/synthetic'};
const locator={method:'querySelector',expression:'#submit',runtimeRequired:false};
class VisibilitySocket extends EventEmitter{
 readonly mode:'malformed'|'send-error'|'missing';
 constructor(mode:'malformed'|'send-error'|'missing'){
  super();this.mode=mode;queueMicrotask(()=>this.emit('open'));
 }
 addEventListener(type:string,fn:(event:any)=>void){this.on(type,fn);}
 removeEventListener(type:string,fn:(event:any)=>void){this.off(type,fn);}
 send(raw:string){
  if(this.mode==='send-error')throw new Error('PRIVATE42 from untrusted transport');
  const request=JSON.parse(raw);
  const data=this.mode==='malformed'?'PRIVATE42':
   JSON.stringify({id:request.id,result:request.method==='DOM.getDocument'?
    {root:{nodeId:1}}:{nodeIds:[]}});
  queueMicrotask(()=>this.emit('message',{data}));
 }
 close(){this.emit('close');}
}

test('RG-07 read-only visibility hides private CDP parser and transport exceptions',async()=>{
 for(const mode of ['malformed','send-error'] as const){
  const socket=new VisibilitySocket(mode);
  await assert.rejects(inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>socket}),error=>{
   assert.ok(error instanceof Error);
   assert.match(error.message,/CDP|visibility/i);
   assert.doesNotMatch(error.message,/PRIVATE42/);
   return true;
  });
  assert.equal(socket.listenerCount('message'),0);
 }
});

test('RG-07 normal missing visibility remains evidence-only, never V2+ success',async()=>{
 const socket=new VisibilitySocket('missing');
 const result=await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>socket});
 assert.equal(result.status,'missing');
 assert.equal(result.matchCount,0);
 assert.equal(result.interactionVerified,false);
 assert.equal(result.V2,'blocked');
 assert.equal(result.V3,'not-configured');
 assert.equal(result.V4,'not-configured');
});
