import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {inspectKnownUserscriptManagerTargets} from '../src/manager-targets.ts';

const browser='ws://127.0.0.1:9223/devtools/browser/verified-browser-token';
const product='Chrome/155.0.8059.40';
const target=(id:string,type='service_worker')=>({
 targetId:'extension-'+id,type,title:'untrusted private page title',
 url:'chrome-extension://'+id+'/background.js',attached:false,
});
class BrowserSocket extends EventEmitter{
 readonly sent:string[]=[];
 closed=false;
 private readonly version:string;
 private readonly targets:unknown[];
 private readonly rawResponse:unknown;
 constructor(version:string=product,targets:unknown[]=[],rawResponse?:unknown){
  super();this.version=version;this.targets=targets;this.rawResponse=rawResponse;
  queueMicrotask(()=>this.emit('open'));
 }
 addEventListener(k:string,f:(event:any)=>void){this.on(k,f);}
 removeEventListener(k:string,f:(event:any)=>void){this.off(k,f);}
 send(value:string){
  const request=JSON.parse(value);this.sent.push(request.method);
  const result=request.method==='Browser.getVersion'?{product:this.version}:
   this.rawResponse??{targetInfos:this.targets};
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:request.id,result})}));
 }
 close(){this.closed=true;this.emit('close');}
}
const run=(socket:BrowserSocket,approved=true)=>inspectKnownUserscriptManagerTargets({
 approved,browserEndpoint:browser,expectedProduct:product,socketFactory:()=>socket,
});
test('only exact official Tampermonkey/Violentmonkey Chrome extension target IDs may appear as observed',async()=>{
 const s=new BrowserSocket(product,[
  target('dhdgffkkebhmkfjojejmpbldmpobfkfo'),
  target('gcalenpjmijncebpfijmoaglllgpjagf','background_page'),
  target('jinjaccalgkegednnccohejagnlnfdag'),
  target('abcdefghijklmnopabcdefghijklmnop'),
  {type:'page',url:'https://private.example/path?token=top-secret',title:'password=42',targetId:'page'},
 ]);
 const result=await run(s);
 assert.deepEqual(result.observed,['tampermonkey-stable','tampermonkey-beta','violentmonkey']);
 assert.equal(result.level,'extension-target-observation-only');
 assert.equal(result.V4,'not-configured');
 assert.equal(result.managerVerified,false);
 assert.deepEqual(s.sent,['Browser.getVersion','Target.getTargets']);
 assert.equal(s.closed,true);
 assert.doesNotMatch(JSON.stringify(result),/token|password|private|background\.js|chrome-extension:\/\//i);
});
test('synthetic MV3 extension is not a Tampermonkey installation or GM API proof',async()=>{
 const s=new BrowserSocket(product,[target('abcdefghijklmnopabcdefghijklmnop')]);
 const result=await run(s);
 assert.deepEqual(result.observed,[]);
 assert.equal(result.managerVerified,false);
 assert.equal(result.V4,'not-configured');
});
test('absence of running extension targets is not proof that any manager is uninstalled',async()=>{
 const result=await run(new BrowserSocket(product,[]));
 assert.deepEqual(result.observed,[]);
 assert.equal(result.inactiveTargetsMayExist,true);
 assert.equal(result.managerVerified,false);
});
test('require explicit consent, verified browser WS identity and exact live browser product',async()=>{
 const unauthorized=new BrowserSocket();
 await assert.rejects(run(unauthorized,false),/approval|consent/i);
 assert.deepEqual(unauthorized.sent,[]);
 await assert.rejects(inspectKnownUserscriptManagerTargets({
  approved:true,browserEndpoint:'ws://evil.example/devtools/browser/token',
  expectedProduct:product,socketFactory:()=>new BrowserSocket(),
 }),/loopback|socket|endpoint/i);
 const mismatched=new BrowserSocket('Chrome/154.0.0.1',[]);
 await assert.rejects(run(mismatched),/identity|version|product/i);
 assert.deepEqual(mismatched.sent,['Browser.getVersion']);
 assert.equal(mismatched.closed,true);
});
test('malformed, oversized or ambiguous target inventories never certify an extension',async()=>{
 for(const reply of [
  {targetInfos:null},{targetInfos:'bad'},
  {targetInfos:Array.from({length:513},()=>target('dhdgffkkebhmkfjojejmpbldmpobfkfo'))},
  {targetInfos:[{type:'service_worker',url:'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/background.js'}]},
  {targetInfos:[{targetId:'a',type:'service_worker',url:'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/background.js'}, {targetId:'a',type:'service_worker',url:'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/background.js'}]},
 ]){
  await assert.rejects(run(new BrowserSocket(product,[],reply)),/invalid|target|budget|identity|duplicate|CDP/i);
 }
});
test('an arbitrary web page with a claimed extension ID or a malformed extension URL is ignored',async()=>{
 const s=new BrowserSocket(product,[
  {...target('dhdgffkkebhmkfjojejmpbldmpobfkfo'),targetId:'ignored-page',type:'page'},
  {...target('dhdgffkkebhmkfjojejmpbldmpobfkfo'),targetId:'ignored-web',url:'https://example.org/path'},
  {...target('dhdgffkkebhmkfjojejmpbldmpobfkfo'),targetId:'ignored-lookalike',url:'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo.evil/background.js'},
 ]);
 assert.deepEqual((await run(s)).observed,[]);
});
