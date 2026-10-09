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
 private attrs=0;
 constructor(disabled=false,mark=true,matchedNodes:readonly number[]=[42]){super();this.disabled=disabled;this.mark=mark;this.matchedNodes=matchedNodes;queueMicrotask(()=>this.emit('open'));}
 addEventListener(n:string,f:(event:any)=>void){this.on(n,f);}
 removeEventListener(n:string,f:(event:any)=>void){this.off(n,f);}
 send(raw:string){
  const m=JSON.parse(raw);this.methods.push(m.method);this.params.push(m.params);
  let result:any={};
  if(m.method==='DOM.getDocument')result={root:{nodeId:1}};
  else if(m.method==='DOM.querySelectorAll')result={nodeIds:this.matchedNodes};
  else if(m.method==='DOM.getAttributes')result={attributes:this.attrs++===0?
    (this.disabled?['disabled','']:['id','fixture-safe-click']):
    (this.mark?['id','fixture-safe-click','data-usshm-v2-fixture','yes']:['id','fixture-safe-click'])};
  else if(m.method==='DOM.getBoxModel')result={model:{content:[20,20,120,20,120,70,20,70]}};
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:m.id,result})}));
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
  'Input.dispatchMouseEvent','Input.dispatchMouseEvent','DOM.getAttributes',
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
