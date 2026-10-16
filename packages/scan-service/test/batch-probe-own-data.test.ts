import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diagnoseScriptsOnPage} from '../src/batch-dom.ts';

const target={
 type:'page',id:'pinned-own-evidence',url:'https://fixture.example.test/stable',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/pinned-own-evidence',
};
const one={
 path:'fixed.user.js',scriptId:'fixed',status:'parsed',
 analysis:{
  metadata:{match:['https://fixture.example.test/*'],include:[],raw:{}},
  selectorRecords:[{
   method:'querySelector',expression:'#fixed',receiver:'document',runtimeRequired:false,
  }],
 },
};
const check=()=>({method:'querySelector',expression:'#fixed',status:'found',matchCount:1});
const normal=()=>({
 targetId:target.id,url:target.url,validationLevel:'dom-only',
 checks:[check()],
});
const deps=(responses:readonly unknown[])=>{
 let calls=0;
 return {
  get calls(){return calls;},
  confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'root',loaderId:'fresh'}),
  probe:async()=>responses[calls++] as any,
 };
};

test('RG-01 never promotes inherited CDP probe top-level identity into V1 DOM evidence',async()=>{
 const forged=Object.create({
  targetId:target.id,url:target.url,validationLevel:'dom-only',
 });
 forged.checks=[check()];
 const d=deps([forged,normal()]);
 const result=await diagnoseScriptsOnPage({
  items:[one,one] as any,target,consent:true,deps:d,
 });
 assert.equal(d.calls,2);
 assert.deepEqual(result.items.map(x=>x.status),['error','dom-present']);
 assert.deepEqual(result.items.map(x=>x.verification?.V1),['blocked','passed']);
 assert.equal(result.items[0]?.reason,'CDP evidence identity or shape mismatch');
});

test('RG-01 does not invoke accessor-backed CDP probe metadata or abort other scripts',async()=>{
 let calls=0;
 const forged=normal() as Record<string,unknown>;
 Object.defineProperty(forged,'targetId',{
  enumerable:true,
  get(){calls++;throw Error('PRIVATE_BROWSER_ADAPTER_PAYLOAD');},
 });
 const d=deps([forged,normal()]);
 const result=await diagnoseScriptsOnPage({
  items:[one,one] as any,target,consent:true,deps:d,
 });
 assert.equal(calls,0,'CDP-adapter getters must not execute in the host');
 assert.equal(d.calls,2,'one malicious adapter response must not abort independent scripts');
 assert.deepEqual(result.items.map(x=>x.status),['error','dom-present']);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_BROWSER_ADAPTER_PAYLOAD/);
});

test('RG-01 rejects inherited or accessor-backed individual DOM check fields without invoking getters',async()=>{
 let calls=0;
 const inherited=Object.create(check());
 const accessor={...check()} as Record<string,unknown>;
 Object.defineProperty(accessor,'status',{
  get(){calls++;throw Error('PRIVATE_LOCATOR_PAYLOAD');},
 });
 for(const bad of [inherited,accessor]){
  const d=deps([{...normal(),checks:[bad]},normal()]);
  const result=await diagnoseScriptsOnPage({
   items:[one,one] as any,target,consent:true,deps:d,
  });
  assert.equal(d.calls,2);
  assert.deepEqual(result.items.map(x=>x.status),['error','dom-present']);
  assert.equal(result.items[0]?.reason,'CDP evidence identity or shape mismatch');
 }
 assert.equal(calls,0);
});

test('RG-01 rejects sparse CDP check arrays without upgrading V1 or terminating a batch',async()=>{
 const holes=new Array(1);
 const d=deps([{...normal(),checks:holes},normal()]);
 const result=await diagnoseScriptsOnPage({
  items:[one,one] as any,target,consent:true,deps:d,
 });
 assert.equal(d.calls,2);
 assert.deepEqual(result.items.map(x=>x.status),['error','dom-present']);
 assert.deepEqual(result.items.map(x=>x.verification?.V1),['blocked','passed']);
});


test('RG-01 inherited Shadow DOM absence cannot turn an unverified selector into a false V1 failure',async()=>{
 const forged=Object.create({
  targetId:target.id,url:target.url,authorShadowTreeNodes:0,
 });
 const result=await diagnoseScriptsOnPage({
  items:[one] as any,target,consent:true,
  deps:{
   confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'root',loaderId:'fresh'}),
   probe:async()=>({...normal(),checks:[{...check(),status:'missing',matchCount:0}]} as any),
   summarize:async()=>forged,
  },
 });
 assert.equal(result.items[0]?.status,'needs-review',
  'an inherited zero ShadowRoot count is not trustworthy evidence of Shadow DOM absence');
 assert.equal(result.items[0]?.verification?.V1,'blocked');
 assert.equal(result.items[0]?.missing,0);
});

test('RG-01 Shadow DOM context accessor does not execute browser-controlled adapter code',async()=>{
 let getterCalls=0;
 const forged={targetId:target.id,url:target.url} as Record<string,unknown>;
 Object.defineProperty(forged,'authorShadowTreeNodes',{
  get(){getterCalls++;throw Error('PRIVATE_BROWSER_SHADOW_CONTEXT');},
 });
 const result=await diagnoseScriptsOnPage({
  items:[one] as any,target,consent:true,
  deps:{
   confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'root',loaderId:'fresh'}),
   probe:async()=>({...normal(),checks:[{...check(),status:'missing',matchCount:0}]} as any),
   summarize:async()=>forged as any,
  },
 });
 assert.equal(getterCalls,0,'never invoke a getter supplied in Shadow DOM adapter data');
 assert.equal(result.items[0]?.status,'needs-review');
 assert.equal(result.items[0]?.verification?.V1,'blocked');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_BROWSER_SHADOW_CONTEXT/);
});


// Hostile adapter objects can be Proxy.revoked or have a trapping 'get'
// despite valid own-data descriptors. Never dereference raw receipts after
// their shape is accepted: normalize the trusted fields first.
function revoked<T extends object>(value:T):T{
 const revocable=Proxy.revocable(value,{});
 revocable.revoke();return revocable.proxy;
}

test('RG-01 revoked CDP packets, arrays and nested checks do not abort unrelated scripts',async()=>{
 const failures:[unknown,string][]=[
  // Async adapter return of a revoked Proxy rejects during Promise thenable
  // assimilation, before the probe-shape classifier receives any packet.
  [revoked(normal()),'CDP locator probe failed'],
  [{...normal(),checks:revoked([check()])},'CDP evidence identity or shape mismatch'],
  [{...normal(),checks:[revoked(check())]},'CDP evidence identity or shape mismatch'],
 ];
 for(const [forged,reason] of failures){
  const d=deps([forged,normal()]);
  const result=await diagnoseScriptsOnPage({items:[one,one] as any,target,consent:true,deps:d});
  assert.equal(d.calls,2);
  assert.deepEqual(result.items.map(x=>x.status),['error','dom-present']);
  assert.equal(result.items[0]?.reason,reason);
 }
});

test('RG-01 uses normalized own-data proof and never runs Proxy get traps after validation',async()=>{
 let getterCalls=0;
 const privateMarker='PRIVATE_BATCH_RAW_GET';
 const trappedRow=new Proxy(check(),{get(){getterCalls++;throw Error(privateMarker);}});
 const trappedPacket=new Proxy({...normal(),checks:[trappedRow]},{
  get(_target,key){
   // Async fixture adapter's Promise resolution is required to inspect
   // 'then' before delivering the packet. Trap only application field reads.
   if(key==='then')return undefined;
   getterCalls++;throw Error(privateMarker);
  },
 });
 const d=deps([trappedPacket,normal()]);
 const result=await diagnoseScriptsOnPage({items:[one,one] as any,target,consent:true,deps:d});
 assert.equal(getterCalls,0);
 assert.equal(d.calls,2);
 assert.deepEqual(result.items.map(x=>x.status),['dom-present','dom-present']);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_BATCH_RAW_GET/);
});
