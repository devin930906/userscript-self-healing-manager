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
