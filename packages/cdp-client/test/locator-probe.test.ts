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

test('DOM collections by name and class return collection presence instead of scalar ambiguity',async()=>{
 const socket=new ProtocolSocket({
  'DOM.getDocument':()=>({root:{nodeId:8}}),
  'DOM.querySelectorAll':({selector})=>({nodeIds:['[name="contact"]','.card.primary'].includes(selector)?[12,13]:[]}),
 });
 const checks=await probePageLocators(page,[
  {method:'getElementsByName',expression:'contact',runtimeRequired:false},
  {method:'getElementsByClassName',expression:'card primary',runtimeRequired:false},
 ],{socketFactory:()=>socket});
 assert.deepEqual(socket.sent.filter(s=>s.method==='DOM.querySelectorAll').map(x=>x.params.selector),['[name="contact"]','.card.primary']);
 assert.deepEqual(checks.checks.map(c=>c.status),['found','found']);
 assert.deepEqual(checks.checks.map(c=>c.matchCount),[2,2]);
});
test('unsafe control characters in getElementsByName remain unverified',async()=>{
 const result=await probePageLocators(page,[{method:'getElementsByName',expression:'x\u0000y',runtimeRequired:false}]);
 assert.equal(result.checks[0]?.status,'unverified');
});

test('malformed or duplicated CDP node IDs must never certify V1 locator evidence',async()=>{
 for(const nodeIds of [[0],[1,1],[12,'13'],[-2],[1.25]]) {
  const socket=new ProtocolSocket({'DOM.getDocument':()=>({root:{nodeId:8}}),'DOM.querySelectorAll':()=>({nodeIds})});
  await assert.rejects(probePageLocators(page,[{method:'querySelector',expression:'#save',runtimeRequired:false}],{socketFactory:()=>socket}),/invalid|duplicate|node/i);
 }
});
test('a huge CDP selector reply is rejected before it can be used as evidence',async()=>{
 const socket=new ProtocolSocket({
  'DOM.getDocument':()=>({root:{nodeId:8}}),
  'DOM.querySelectorAll':()=>({nodeIds:[31],untrustedPadding:'x'.repeat(1_200_000)}),
 });
 await assert.rejects(probePageLocators(page,[{method:'querySelector',expression:'#save',runtimeRequired:false}],{socketFactory:()=>socket}),/size|limit/i);
});
test('an unbounded selector match list fails closed instead of accepting false confidence',async()=>{
 const socket=new ProtocolSocket({
  'DOM.getDocument':()=>({root:{nodeId:8}}),
  'DOM.querySelectorAll':()=>({nodeIds:Array.from({length:10001},(_,i)=>i+1)}),
 });
 await assert.rejects(probePageLocators(page,[{method:'querySelectorAll',expression:'*',runtimeRequired:false}],{socketFactory:()=>socket}),/count|limit/i);
});

test('duplicate document replies cannot enqueue another locator query or certify evidence',async()=>{
 class DuplicateRootSocket extends ProtocolSocket {
  override send(raw:string){
   super.send(raw);
   const request=JSON.parse(raw);
   if(request.method==='DOM.getDocument')
    queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:request.id,result:{root:{nodeId:8}}})}));
  }
 }
 const socket=new DuplicateRootSocket({
  'DOM.getDocument':()=>({root:{nodeId:8}}),
  'DOM.querySelectorAll':()=>({nodeIds:[31]}),
 });
 await assert.rejects(probePageLocators(page,[{method:'querySelector',expression:'#save',runtimeRequired:false}],{socketFactory:()=>socket}),/duplicate.*document/i);
 assert.equal(socket.sent.filter(x=>x.method==='DOM.querySelectorAll').length,1);
});

test('opt-in backend node fingerprint uses only CDP read-only DOM.describeNode and hashes identity',async()=>{
 const socket=new ProtocolSocket({
  'DOM.getDocument':()=>({root:{nodeId:8}}),
  'DOM.querySelectorAll':({selector})=>({nodeIds:selector==='#save'?[31]:[]}),
  'DOM.describeNode':({nodeId})=>({node:{nodeId,backendNodeId:4791,nodeType:1}}),
 });
 const result=await probePageLocators(page,[
  {method:'querySelectorAll',expression:'#save',runtimeRequired:false},
  {method:'querySelectorAll',expression:'.missing',runtimeRequired:false},
 ],{socketFactory:()=>socket,includeNodeFingerprints:true});
 const check=result.checks[0]!;
 assert.match(check.nodeFingerprint??'',/^[0-9a-f]{64}$/);
 assert.equal(result.checks[1]?.nodeFingerprint,undefined);
 assert.equal(JSON.stringify(result).includes('backendNodeId'),false);
 assert.deepEqual(socket.sent.map(x=>x.method),['DOM.getDocument','DOM.querySelectorAll','DOM.querySelectorAll','DOM.describeNode']);
});
test('malformed or unavailable node identity fails closed for opt-in fingerprint checks',async()=>{
 for(const backendNodeId of [0,-1,'123',null,1.5]){
  const socket=new ProtocolSocket({
   'DOM.getDocument':()=>({root:{nodeId:8}}),
   'DOM.querySelectorAll':()=>({nodeIds:[31]}),
   'DOM.describeNode':()=>({node:{backendNodeId,nodeType:1}}),
  });
  const result=await probePageLocators(page,[{method:'querySelectorAll',expression:'#save',runtimeRequired:false}],{socketFactory:()=>socket,includeNodeFingerprints:true});
  assert.equal(result.checks[0]?.nodeFingerprint,undefined);
  assert.notEqual(result.checks[0]?.status,'found');
 }
});

test('backend node identity digest is stable for one node across sockets but changes for a replacement',async()=>{
 const identities:number[]=[41,41,42];
 const digests:string[]=[];
 for(const backendNodeId of identities){
  const socket=new ProtocolSocket({
   'DOM.getDocument':()=>({root:{nodeId:8}}),
   'DOM.querySelectorAll':()=>({nodeIds:[31]}),
   'DOM.describeNode':()=>({node:{backendNodeId,nodeType:1}}),
  });
  const sampled=await probePageLocators(page,[{method:'querySelectorAll',expression:'#save',runtimeRequired:false}],{
   socketFactory:()=>socket,includeNodeFingerprints:true,
  });
  assert.equal(sampled.checks[0]?.status,'found');
  digests.push(sampled.checks[0]!.nodeFingerprint!);
 }
 assert.equal(digests[0],digests[1]);
 assert.notEqual(digests[1],digests[2]);
 // A process-local HMAC must not equal the publicly computable SHA256 of a
 // small backend ID: the IPC-visible value must not disclose the raw ID.
 const {createHash}=await import('node:crypto');
 const plain=createHash('sha256').update('usshm-cdp-backend-node-v1:').update('41').digest('hex');
 assert.notEqual(digests[0],plain);
});

test('opt-in identity for two nodes hashes a bounded, sorted set without leaking IDs',async()=>{
 const socket=new ProtocolSocket({
  'DOM.getDocument':()=>({root:{nodeId:8}}),
  'DOM.querySelectorAll':()=>({nodeIds:[51,31]}),
  'DOM.describeNode':({nodeId})=>({node:{backendNodeId:nodeId===51?801:305,nodeType:1}}),
 });
 const result=await probePageLocators(page,[{method:'querySelectorAll',expression:'.batch',runtimeRequired:false}],{
  socketFactory:()=>socket,includeNodeFingerprints:true,
 });
 const check=result.checks[0]!;
 assert.equal(check.matchCount,2);
 assert.equal(check.status,'found');
 assert.equal(check.nodeFingerprint,undefined);
 assert.equal(check.nodeFingerprints?.length,2);
 assert.deepEqual(check.nodeFingerprints,[...check.nodeFingerprints!].sort());
 assert.ok(check.nodeFingerprints!.every(x=>/^[0-9a-f]{64}$/.test(x)));
 assert.equal(JSON.stringify(result).includes('backendNodeId'),false);
 assert.equal(socket.sent.filter(x=>x.method==='DOM.describeNode').length,2);
});
test('duplicate or incomplete backend node identities never certify a two-element match',async()=>{
 for(const mode of ['duplicate','invalid']){
  const socket=new ProtocolSocket({
   'DOM.getDocument':()=>({root:{nodeId:8}}),
   'DOM.querySelectorAll':()=>({nodeIds:[10,20]}),
   'DOM.describeNode':({nodeId})=>({node:{backendNodeId:mode==='duplicate'?77:nodeId===10?10:null,nodeType:1}}),
  });
  const check=(await probePageLocators(page,[{method:'querySelectorAll',expression:'.batch',runtimeRequired:false}],{
   socketFactory:()=>socket,includeNodeFingerprints:true,
  })).checks[0]!;
  assert.equal(check.status,'unverified');
  assert.equal(check.nodeFingerprints,undefined);
 }
});
test('unbounded identity sets never send read-only describe commands or publish verified fingerprints',async()=>{
 const socket=new ProtocolSocket({
  'DOM.getDocument':()=>({root:{nodeId:8}}),
  'DOM.querySelectorAll':()=>({nodeIds:Array.from({length:11},(_,i)=>i+20)}),
 });
 const check=(await probePageLocators(page,[{method:'querySelectorAll',expression:'.batch',runtimeRequired:false}],{
  socketFactory:()=>socket,includeNodeFingerprints:true,
 })).checks[0]!;
 assert.equal(check.status,'unverified');
 assert.equal(check.matchCount,11);
 assert.equal(check.nodeFingerprints,undefined);
 assert.equal(socket.sent.filter(x=>x.method==='DOM.describeNode').length,0);
});

test('explicit open-shadow scope uses one bounded top-page open root, not document root',async()=>{
 const socket=new ProtocolSocket({
  'DOM.getDocument':()=>({root:{nodeId:8,children:[{nodeId:11,shadowRoots:[{nodeId:82,shadowRootType:'open'}]}]}}),
  'DOM.querySelectorAll':({nodeId,selector})=>({nodeIds:nodeId===82&&selector==='#shadow-send'?[101]:[]}),
  'DOM.describeNode':()=>({node:{backendNodeId:882,nodeType:1}}),
 });
 const result=await probePageLocators(page,[{method:'querySelectorAll',expression:'#shadow-send',runtimeRequired:false}],{
  socketFactory:()=>socket,includeNodeFingerprints:true,rootScope:'open-shadow',
 });
 assert.equal(result.checks[0]?.status,'found');
 assert.match(result.checks[0]?.nodeFingerprint??'',/^[a-f0-9]{64}$/);
 assert.equal(socket.sent[0]?.method,'DOM.getDocument');
 assert.deepEqual(socket.sent[0]?.params,{depth:-1,pierce:true});
 assert.deepEqual(socket.sent.filter(x=>x.method==='DOM.querySelectorAll').map(x=>x.params.nodeId),[82]);
});
test('open-shadow scope fails closed on ambiguous, nested, closed or malformed roots without selector commands',async()=>{
 const trees=[
  {nodeId:8,children:[{nodeId:11,shadowRoots:[{nodeId:82,shadowRootType:'open'},{nodeId:83,shadowRootType:'open'}]}]},
  {nodeId:8,children:[{nodeId:11,shadowRoots:[{nodeId:82,shadowRootType:'closed'}]}]},
  {nodeId:8,children:[{nodeId:11,shadowRoots:[{nodeId:82,shadowRootType:'open'},{nodeId:83,shadowRootType:'closed'}]}]},
  {nodeId:8,children:[{nodeId:11,shadowRoots:[{nodeId:82,shadowRootType:'open',children:[{nodeId:13,shadowRoots:[{nodeId:89,shadowRootType:'open'}]}]}]}]},
  {nodeId:8,children:[{nodeId:11,shadowRoots:[{nodeId:'bad',shadowRootType:'open'}]}]},
 ];
 for(const root of trees){
  const socket=new ProtocolSocket({'DOM.getDocument':()=>({root})});
  const result=await probePageLocators(page,[{method:'querySelectorAll',expression:'#shadow-send',runtimeRequired:false}],{
   socketFactory:()=>socket,includeNodeFingerprints:true,rootScope:'open-shadow',
  });
  assert.equal(result.checks[0]?.status,'unverified');
  assert.equal(socket.sent.filter(x=>x.method==='DOM.querySelectorAll').length,0);
 }
});
test('unknown shadow scopes and oversized trees must not silently fall back to document root',async()=>{
 await assert.rejects(probePageLocators(page,[],{rootScope:'pierce-all' as 'open-shadow'}),/scope|root/i);
 const socket=new ProtocolSocket({'DOM.getDocument':()=>({root:{nodeId:8,children:Array.from({length:1800},(_,i)=>({nodeId:i+50}))}})});
 const result=await probePageLocators(page,[{method:'querySelectorAll',expression:'#shadow-send',runtimeRequired:false}],{
  socketFactory:()=>socket,rootScope:'open-shadow',
 });
 assert.equal(result.checks[0]?.status,'unverified');
 assert.equal(socket.sent.filter(x=>x.method==='DOM.querySelectorAll').length,0);
});
