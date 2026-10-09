import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {runIsolatedFixtureInteraction} from '../../scripts/local-fixture-interaction.ts';

const url='http://127.0.0.1:43219/fixture';
const target={id:'synthetic-fixture',type:'page',url,
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/synthetic-fixture'};
const identity={targetId:target.id,confirmedUrl:url,frameId:'f',loaderId:'l'};
class FixtureSocket extends EventEmitter{
 readonly methods:string[]=[];
 readonly params:unknown[]=[];
 readonly disabled:boolean;
 readonly mark:boolean;
 readonly matchedNodes:readonly number[];
 readonly replacedAfterClick:boolean;
 readonly preMarked:boolean;
 readonly unsafeButtonType:boolean;
 readonly invalidAriaDisabled:boolean;
 readonly postInvalidAriaDisabled:boolean;
 readonly changedNodesAfterClick:readonly number[]|null;
 readonly blockedAttr:'inert'|'aria-hidden'|'aria-hidden-unknown'|null;
 readonly postBlockedAttr:'inert'|'aria-hidden'|null;
 readonly malformedResult:boolean;
 private queryCount=0;
 private attrs=0;
 constructor(disabled=false,mark=true,matchedNodes:readonly number[]=[42],replacedAfterClick=false,preMarked=false,unsafeButtonType=false,invalidAriaDisabled=false,postInvalidAriaDisabled=false,changedNodesAfterClick:readonly number[]|null=null,blockedAttr:'inert'|'aria-hidden'|'aria-hidden-unknown'|null=null,postBlockedAttr:'inert'|'aria-hidden'|null=null,malformedResult=false){super();this.disabled=disabled;this.mark=mark;this.matchedNodes=matchedNodes;this.replacedAfterClick=replacedAfterClick;this.preMarked=preMarked;this.unsafeButtonType=unsafeButtonType;this.invalidAriaDisabled=invalidAriaDisabled;this.postInvalidAriaDisabled=postInvalidAriaDisabled;this.changedNodesAfterClick=changedNodesAfterClick;this.blockedAttr=blockedAttr;this.postBlockedAttr=postBlockedAttr;this.malformedResult=malformedResult;queueMicrotask(()=>this.emit('open'));}
 addEventListener(n:string,f:(event:any)=>void){this.on(n,f);}
 removeEventListener(n:string,f:(event:any)=>void){this.off(n,f);}
 send(raw:string){
  const m=JSON.parse(raw);this.methods.push(m.method);this.params.push(m.params);
  let result:any={};
  if(m.method==='DOM.getDocument')result={root:{nodeId:1}};
  else if(m.method==='DOM.querySelectorAll')result={nodeIds:this.queryCount++===0?this.matchedNodes:(this.changedNodesAfterClick??this.matchedNodes)};
  else if(m.method==='DOM.getAttributes')result={attributes:this.attrs++===0?
    (this.disabled?['disabled','']:(this.preMarked?['id','fixture-safe-click','type',this.unsafeButtonType?'submit':'button','data-usshm-v2-fixture','yes']:['id','fixture-safe-click','type',this.unsafeButtonType?'submit':'button',...(this.invalidAriaDisabled?['aria-disabled','maybe']:[]),...(this.blockedAttr?[this.blockedAttr==='aria-hidden-unknown'?'aria-hidden':this.blockedAttr,this.blockedAttr==='inert'?'':this.blockedAttr==='aria-hidden-unknown'?'maybe':'true']:[])])):
    (this.mark?[...(this.replacedAfterClick?['id','different-button']:['id','fixture-safe-click']),'type',this.unsafeButtonType?'submit':'button','data-usshm-v2-fixture','yes',...(this.postInvalidAriaDisabled?['aria-disabled','maybe']:[]),...(this.postBlockedAttr?[this.postBlockedAttr,this.postBlockedAttr==='inert'?'':'true']:[])]:['id','fixture-safe-click','type',this.unsafeButtonType?'submit':'button'])};
  else if(m.method==='DOM.getBoxModel')result={model:{content:[20,20,120,20,120,70,20,70]}};
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:m.id,result:this.malformedResult?null:result})}));
 }
 close(){this.emit('close');}
}
test('synthetic V2 fixture interacts through bounded DOM and Input CDP commands only',async()=>{
 let socket!:FixtureSocket;
 const out=await runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>identity,socketFactory:()=>{socket=new FixtureSocket();return socket;}});
 assert.equal(out.validationLevel,'synthetic-fixture-interaction');
 assert.equal(out.observed,true);
 assert.equal(out.productionEligible,false);
 assert.deepEqual(socket.methods,[
  'DOM.getDocument','DOM.querySelectorAll','DOM.getAttributes','DOM.getBoxModel',
  'Input.dispatchMouseEvent','Input.dispatchMouseEvent','DOM.querySelectorAll','DOM.getAttributes',
 ]);
 assert.ok(socket.methods.every(m=>!m.startsWith('Runtime.')&&!m.startsWith('Page.')&&!m.startsWith('Network.')));
 assert.equal((socket.params[1] as any).selector,'#fixture-safe-click');
 assert.deepEqual(socket.params.slice(4,6).map((x:any)=>x.type),['mousePressed','mouseReleased']);
});
test('fixture interaction rejects arbitrary pages, URLs, missing approval and invalid time budgets before connecting',async()=>{
 const deps={confirm:async()=>identity,socketFactory:()=>{throw Error('must not connect');}};
 for(const invalid of [
  {approved:false,target,fixtureUrl:url},
  {approved:true,target:{...target,url:'https://example.com'},fixtureUrl:url},
  {approved:true,target:{...target,url:'https://example.com'},fixtureUrl:'https://example.com'},
  {approved:true,target:{...target,url:'http://localhost:43219/fixture'},fixtureUrl:'http://localhost:43219/fixture'},
  {approved:true,target:{...target,url:url+'?next=pay'},fixtureUrl:url+'?next=pay'},
  {approved:true,target,fixtureUrl:url,timeoutMs:60000},
 ]){
  await assert.rejects(runIsolatedFixtureInteraction({...invalid,...deps} as any),/approval|fixture|local|timeout|unsupported|mismatch/i);
 }
});
test('disabled synthetic button fails closed before dispatching any Input event',async()=>{
 let socket!:FixtureSocket;
 await assert.rejects(runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>identity,socketFactory:()=>{socket=new FixtureSocket(true);return socket;}}),/disabled|blocked/i);
 assert.ok(!socket.methods.some(m=>m.startsWith('Input.')));
});
test('same-URL loader reload never certifies synthetic interaction',async()=>{
 let calls=0;
 await assert.rejects(runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>({...identity,loaderId:++calls===1?'l':'reload'}),
  socketFactory:()=>new FixtureSocket()}),/document|identity|loader|navigation|reload/i);
});

test('a delivered input event without the required fixture side effect cannot be called a pass',async()=>{
 const result=await runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>identity,socketFactory:()=>new FixtureSocket(false,false)});
 assert.equal(result.observed,false);
 assert.equal(result.productionEligible,false);
});
test('synthetic interaction must remain outside every Electron production entrypoint',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const path of [
  '../../apps/desktop/src/main/index.ts',
  '../../apps/desktop/src/preload/index.ts',
  '../../apps/desktop/src/renderer/App.tsx',
 ]){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  assert.doesNotMatch(source,/local-fixture-interaction|runIsolatedFixtureInteraction/,
   'Synthetic Input.dispatchMouseEvent must not be exposed to the app');
 }
});

test('fixture refuses ambiguous, missing or malformed button matches before any Input event',async()=>{
 for(const ids of [[],[42,43],[42,42],[0],[42,-1]]){
  let socket!:FixtureSocket;
  await assert.rejects(runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
   confirm:async()=>identity,socketFactory:()=>{socket=new FixtureSocket(false,true,ids);return socket;}}),
   /fixture|button|unique|ambiguous|invalid|missing/i);
  assert.deepEqual(socket.methods,['DOM.getDocument','DOM.querySelectorAll']);
  assert.ok(!socket.methods.some(m=>m.startsWith('Input.')));
 }
});

test('fixture cannot certify a marked replacement button after the synthetic click',async()=>{
 const result=await runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>identity,socketFactory:()=>new FixtureSocket(false,true,[42],true)});
 assert.equal(result.observed,false);
 assert.equal(result.productionEligible,false);
});

test('a success marker already present before the click cannot certify a new interaction',async()=>{
 let socket!:FixtureSocket;
 await assert.rejects(runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>identity,socketFactory:()=>{socket=new FixtureSocket(false,true,[42],false,true);return socket;}}),
  /preexisting|already|marker|fixture/i);
 assert.ok(!socket.methods.some(m=>m.startsWith('Input.')));
});

test('synthetic fixture rejects submit-type buttons before any mouse event',async()=>{
 let socket!:FixtureSocket;
 await assert.rejects(runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>identity,socketFactory:()=>{socket=new FixtureSocket(false,true,[42],false,false,true);return socket;}}),
  /button|type|fixture|submit/i);
 assert.ok(!socket.methods.some(m=>m.startsWith('Input.')));
});

test('synthetic fixture refuses unknown aria-disabled states before click',async()=>{
 let socket!:FixtureSocket;
 await assert.rejects(runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>identity,socketFactory:()=>{socket=new FixtureSocket(false,true,[42],false,false,false,true);return socket;}}),
  /disabled|blocked|invalid/i);
 assert.ok(!socket.methods.some(m=>m.startsWith('Input.')));
});

test('ambiguous aria-disabled after the synthetic click cannot certify the interaction',async()=>{
 const out=await runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>identity,socketFactory:()=>new FixtureSocket(false,true,[42],false,false,false,false,true)});
 assert.equal(out.observed,false);
 assert.equal(out.productionEligible,false);
});

test('synthetic fixture refuses a changed or ambiguous selector after click',async()=>{
 for(const ids of [[],[99],[42,43]]){
  const out=await assert.rejects(runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
   confirm:async()=>identity,socketFactory:()=>new FixtureSocket(false,true,[42],false,false,false,false,false,ids)}),
   /fixture|target|button|unique|valid/i);
  assert.equal(out,undefined);
 }
});

test('synthetic fixture refuses inert or aria-hidden buttons without dispatching clicks',async()=>{
 for(const attr of ['inert','aria-hidden'] as const){
  let socket!:FixtureSocket;
  await assert.rejects(runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
   confirm:async()=>identity,socketFactory:()=>{socket=new FixtureSocket(false,true,[42],false,false,false,false,false,null,attr);return socket;}}),
   /button|blocked|disabled/i);
  assert.ok(!socket.methods.some(method=>method.startsWith('Input.')));
 }
});

test('unknown aria-hidden state fails closed before clicking the fixture',async()=>{
 let socket!:FixtureSocket;
 await assert.rejects(runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>identity,socketFactory:()=>{socket=new FixtureSocket(false,true,[42],false,false,false,false,false,null,'aria-hidden-unknown');return socket;}}),
  /button|blocked|disabled/i);
 assert.ok(!socket.methods.some(method=>method.startsWith('Input.')));
});

test('synthetic click success cannot be claimed when target turns inert or aria-hidden',async()=>{
 for(const attr of ['inert','aria-hidden'] as const){
  const out=await runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
   confirm:async()=>identity,socketFactory:()=>new FixtureSocket(false,true,[42],false,false,false,false,false,null,null,attr)});
  assert.equal(out.observed,false);
  assert.equal(out.productionEligible,false);
 }
});

test('malformed CDP result payload cannot trigger synthetic Input events',async()=>{
 let socket!:FixtureSocket;
 await assert.rejects(runIsolatedFixtureInteraction({approved:true,target,fixtureUrl:url,
  confirm:async()=>identity,socketFactory:()=>{socket=new FixtureSocket(false,true,[42],false,false,false,false,false,null,null,null,true);return socket;}}),
  /invalid|CDP|result/i);
 assert.ok(!socket.methods.some(method=>method.startsWith('Input.')));
});
