import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {verifyBrowserCdpHandshake,waitForChromeDebugger} from '../src/index.ts';

const endpoint='ws://127.0.0.1:9223/devtools/browser/test-token';
class FakeBrowserSocket extends EventEmitter {
 sent:string[]=[];
 private readonly response:unknown;
 constructor(response:unknown){super();this.response=response;queueMicrotask(()=>this.emit('open'));}
 addEventListener(name:string,callback:(event:any)=>void){this.on(name,callback);}
 removeEventListener(name:string,callback:(event:any)=>void){this.off(name,callback);}
 send(message:string){
  this.sent.push(message);
  const request=JSON.parse(message);
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:request.id,result:this.response})}));
 }
 close(){this.emit('close');}
}
test('real browser CDP readiness requires a successful read-only Browser.getVersion response',async()=>{
 const socket=new FakeBrowserSocket({product:'Chrome/155.0.8059.40'});
 const value=await verifyBrowserCdpHandshake({
  endpoint,port:9223,socketFactory:()=>socket,
 });
 assert.equal(value,'Chrome/155.0.8059.40');
 assert.deepEqual(socket.sent.map(x=>JSON.parse(x).method),['Browser.getVersion']);
});
test('browser socket handshake refuses a response without a validated Chrome product',async()=>{
 for(const product of ['',42,'Other/155',null]){
  const socket=new FakeBrowserSocket({product});
  await assert.rejects(verifyBrowserCdpHandshake({endpoint,port:9223,socketFactory:()=>socket}),/browser|CDP|product|version/i);
 }
 await assert.rejects(verifyBrowserCdpHandshake({endpoint,port:9224,socketFactory:()=>new FakeBrowserSocket({product:'Chrome/155'})}),/port/i);
 await assert.rejects(verifyBrowserCdpHandshake({
  endpoint:'ws://evil.example/devtools/browser/test-token',port:9223,
  socketFactory:()=>new FakeBrowserSocket({product:'Chrome/155'}),
 }),/loopback/i);
});
test('Chrome launcher fails closed if the HTTP debugger exists but Browser.getVersion WebSocket fails',async()=>{
 const status={browser:'Chrome/155',protocolVersion:'1.3',pages:[],browserSocket:endpoint};
 let checked=0;
 await assert.rejects(waitForChromeDebugger({
  port:9223,timeoutMs:35,pollMs:1,
  inspect:async()=>status,
  verifySocket:async()=>{checked++;throw new Error('CDP browser socket rejected');},
  delay:async()=>new Promise(resolve=>setTimeout(resolve,2)),
 }),/handshake|CDP/i);
 assert.ok(checked>0,'browser socket must actually be verified');
});

test('RG-07 Chrome readiness failure must not echo private CDP exceptions',async()=>{
 const canary='PRIVATE_ACCOUNT_TOKEN_SHOULD_NEVER_ESCAPE';
 const status={browser:'Chrome/155',protocolVersion:'1.3',pages:[],browserSocket:endpoint};
 for(const from of ['inspect','socket'] as const){
  let socketChecks=0;
  await assert.rejects(waitForChromeDebugger({
   port:9223,timeoutMs:25,pollMs:5,
   inspect:async()=>{
    if(from==='inspect')throw new Error('Untrusted HTTP payload '+canary);
    return status;
   },
   verifySocket:async()=>{socketChecks++;throw new Error('Untrusted WS payload '+canary);},
   delay:async()=>{await new Promise<void>(resolve=>setTimeout(resolve,1));},
  }),error=>{
   assert.ok(error instanceof Error);
   assert.match(error.message,/Chrome CDP handshake not verified/);
   assert.doesNotMatch(error.message,/PRIVATE_ACCOUNT_TOKEN_SHOULD_NEVER_ESCAPE/);
   return true;
  });
  if(from==='socket')assert.ok(socketChecks>0,'must exercise rejected WebSocket response');
 }
});

test('RG-07 malformed Chrome version JSON must not leak parser payload to callers',async()=>{
 const socket=new FakeBrowserSocket({product:'Chrome/155'});
 socket.send=(_request:string)=>{
  queueMicrotask(()=>socket.emit('message',{data:'PRIVATE42'}));
 };
 await assert.rejects(verifyBrowserCdpHandshake({
  endpoint,port:9223,socketFactory:()=>socket,
 }),error=>{
  assert.ok(error instanceof Error);
  assert.match(error.message,/CDP browser handshake/i);
  assert.doesNotMatch(error.message,/PRIVATE42/);
  return true;
 });
});
