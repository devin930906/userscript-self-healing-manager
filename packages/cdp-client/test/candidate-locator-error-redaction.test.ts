import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {captureCandidateNodes} from '../src/candidate-snapshot.ts';
import {probePageLocators} from '../src/locator-probe.ts';

const page={
 type:'page',id:'fixture',url:'https://fixture.example.invalid/editor',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fixture',
};
const privateMarker='PRIVATE42';
class UntrustedCdpSocket extends EventEmitter{
 readonly mode:'malformed-json'|'send-exception';
 constructor(mode:'malformed-json'|'send-exception'){
  super();this.mode=mode;queueMicrotask(()=>this.emit('open'));
 }
 addEventListener(event:string,cb:(event:any)=>void){this.on(event,cb);}
 removeEventListener(event:string,cb:(event:any)=>void){this.off(event,cb);}
 send(_command:string){
  if(this.mode==='send-exception')throw new Error(privateMarker+' synthetic transport exception');
  queueMicrotask(()=>this.emit('message',{data:privateMarker}));
 }
 close(){this.emit('close');}
}

test('RG-07 candidate DOM snapshot rejects hostile CDP errors without echoing page data',async()=>{
 for(const mode of ['malformed-json','send-exception'] as const){
  const socket=new UntrustedCdpSocket(mode);
  await assert.rejects(captureCandidateNodes(page,{socketFactory:()=>socket}),error=>{
   assert.ok(error instanceof Error);
   assert.match(error.message,/CDP|snapshot/i);
   assert.doesNotMatch(error.message,/PRIVATE42/,'untrusted DOM data must not leave CDP adapter');
   return true;
  });
  assert.equal(socket.listenerCount('message'),0,'event listeners must be released');
 }
});

test('RG-07 read-only locator probes reject hostile CDP errors without echoing page data',async()=>{
 const locators=[{method:'querySelector',expression:'#submit',runtimeRequired:false}];
 for(const mode of ['malformed-json','send-exception'] as const){
  const socket=new UntrustedCdpSocket(mode);
  await assert.rejects(probePageLocators(page,locators,{socketFactory:()=>socket}),error=>{
   assert.ok(error instanceof Error);
   assert.match(error.message,/CDP|locator/i);
   assert.doesNotMatch(error.message,/PRIVATE42/,'untrusted CDP data must not leave locator probe');
   return true;
  });
  assert.equal(socket.listenerCount('message'),0,'event listeners must be released');
 }
});
