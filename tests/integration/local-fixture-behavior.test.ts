import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {runIsolatedFixtureBehavior} from '../../scripts/local-fixture-behavior.ts';

const fixtureUrl='http://127.0.0.1:44521/fixture';
const target={id:'fixture-tab',type:'page',url:fixtureUrl,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fixture-tab'};
const source='// ==UserScript==\n// @name Local CDP Smoke\n// @match http://127.0.0.1/*\n// ==/UserScript==\nconst action=document.querySelector("#old-heal-button");\nif(action)action.setAttribute("data-usshm-functional","pass");\n';
class FixtureSocket extends EventEmitter{
 sent:unknown[]=[];
 readonly value:boolean;readonly fail:boolean;
 constructor(value:boolean,fail=false){super();this.value=value;this.fail=fail;queueMicrotask(()=>this.emit('open'));}
 addEventListener(event:string,listener:(e:any)=>void){this.on(event,listener);}
 removeEventListener(event:string,listener:(e:any)=>void){this.off(event,listener);}
 send(message:string){
  const request=JSON.parse(message);this.sent.push(request);
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify(this.fail
   ? {id:request.id,result:{exceptionDetails:{text:'ReferenceError: fixture failed'}}}
   : {id:request.id,result:{result:{type:'boolean',value:this.value}}})}));
 }
 close(){this.emit('close');}
}
test('explicit local-only fixture can verify behavior via isolated Chrome runtime without exposing a desktop userscript execution API',async()=>{
 const socket=new FixtureSocket(true);let confirms=0;
 const observed=await runIsolatedFixtureBehavior({
  target,fixtureUrl,source,
  confirm:async()=>{confirms++;return {targetId:target.id,confirmedUrl:fixtureUrl};},
  socketFactory:()=>socket,
 });
 assert.equal(observed,true);
 assert.equal(confirms,2,'must verify the live top frame on both sides of fixture execution');
 assert.equal(socket.sent.length,1);
 const request=socket.sent[0] as {method:string;params:{expression:string;returnByValue:boolean}};
 assert.equal(request.method,'Runtime.evaluate');
 assert.equal(request.params.returnByValue,true);
 assert.match(request.params.expression,/data-usshm-functional/);
 assert.match(request.params.expression,/#old-heal-button/);
});
test('a missing selector returns false, not a false functional success',async()=>{
 const worked=await runIsolatedFixtureBehavior({
  target,fixtureUrl,source,confirm:async()=>({targetId:target.id,confirmedUrl:fixtureUrl}),
  socketFactory:()=>new FixtureSocket(false),
 });
 assert.equal(worked,false);
});
test('fixture executor refuses foreign URLs, non-local fixtures, and arbitrary userscript sources',async()=>{
 const confirm=async()=>({targetId:target.id,confirmedUrl:fixtureUrl});
 let opened=0;
 const socketFactory=()=>{opened++;return new FixtureSocket(true);};
 const cases=[
  {target:{...target,url:'https://example.com/private'},fixtureUrl:'https://example.com/private',source},
  {target,fixtureUrl:'http://127.0.0.1:44521/admin',source},
  {target,fixtureUrl,source:'// ==UserScript==\n// @name Untrusted\n// ==/UserScript==\nalert(1)'},
 ];
 for(const candidate of cases){
  await assert.rejects(runIsolatedFixtureBehavior({...candidate,confirm,socketFactory}),/fixture|localhost|synthetic|refus|safe|target/i);
 }
 assert.equal(opened,0,'never connect or execute a disallowed fixture');
});
test('navigation and runtime exceptions fail closed rather than reporting script repair success',async()=>{
 let opened=0;
 await assert.rejects(runIsolatedFixtureBehavior({
  target,fixtureUrl,source,
  confirm:async()=>({targetId:target.id,confirmedUrl:'http://127.0.0.1:44521/other'}),
  socketFactory:()=>{opened++;return new FixtureSocket(true);},
 }),/identity|navigat|frame|URL/i);
 assert.equal(opened,0);
 await assert.rejects(runIsolatedFixtureBehavior({
  target,fixtureUrl,source,
  confirm:async()=>({targetId:target.id,confirmedUrl:fixtureUrl}),
  socketFactory:()=>new FixtureSocket(true,true),
 }),/exception|failed|script/i);
});
