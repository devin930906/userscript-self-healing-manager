import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

const extension='jinjaccalgkegednnccohejagnlnfdag';
const options='chrome-extension://'+extension+'/options/index.html#settings';
const worldId='usshm-rg05-direct-control-world-v1';
function worldApi(){
 let configured=false;
 return {
  async getWorldConfigurations(){return configured?[{worldId,messaging:true}]:[];},
  async configureWorld(args:any){
   assert.deepEqual(JSON.parse(JSON.stringify(args)),{worldId,messaging:true});
   configured=true;
  },
  async resetWorldConfiguration(id:string){assert.equal(id,worldId);configured=false;},
 };
}
const site='http://127.0.0.1:32123/rg05-direct-control';

test('RG-05 USER_SCRIPT roundtrip accepts only a real bounded onUserScriptMessage reply',async()=>{
 const api=await import('../../scripts/violentmonkey-direct-chrome-control.ts');
 assert.equal(typeof api.buildDirectChromeUserScriptListenerInstallation,'function');
 assert.equal(typeof api.buildDirectChromeUserScriptListenerRemoval,'function');
 let listener:any,registered:any,removed=0;
 const context:any={
  location:{href:options},window:{},JSON,
  chrome:{runtime:{id:extension,onUserScriptMessage:{
   addListener(fn:any){assert.equal(listener,undefined);listener=fn;},
   removeListener(fn:any){assert.equal(fn,listener);listener=undefined;removed++;},
  }},userScripts:{
   ...worldApi(),
   async getScripts(){return registered?[registered]:[];},
   async register(xs:any[]){registered=xs[0];},
   async unregister(){registered=undefined;},
  }},
 };
 const install=api.buildDirectChromeUserScriptListenerInstallation(site);
 const cleanup=api.buildDirectChromeUserScriptListenerRemoval();
 assert.equal(vm.runInNewContext(install,context),'attached');
 assert.equal(vm.runInNewContext(install,context),'unavailable','duplicate listeners must be refused');
 assert.equal(await vm.runInNewContext(api.buildDirectChromeUserScriptRegistration(site),context),'registered');
 assert.equal(typeof listener,'function');
 const recorded:Record<string,string>={};
 const page={
  location:{href:site},document:{documentElement:{setAttribute(key:string,value:string){recorded[key]=value;}}},
  chrome:{runtime:{
   sendMessage(payload:any){
    let answer:any;
    listener(payload,{id:extension,url:site},(reply:any)=>{answer=reply;});
    return Promise.resolve(answer);
   },
   onMessage:{addListener(){}},
  }},
 };
 vm.runInNewContext(registered.js[0].code,page);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(recorded['data-usshm-rg05-direct-control'],'send-onmessage');
 assert.equal(recorded['data-usshm-rg05-direct-roundtrip'],'verified');
 const denied:Record<string,string>={};
 vm.runInNewContext(registered.js[0].code,{
  location:{href:site},document:{documentElement:{setAttribute(k:string,v:string){denied[k]=v;}}},
  chrome:{runtime:{sendMessage(){return Promise.resolve({status:'forged'});}}},
 });
 await new Promise(resolve=>setImmediate(resolve));
 assert.notEqual(denied['data-usshm-rg05-direct-roundtrip'],'verified',
  'unrelated replies cannot create synthetic positive evidence');
 assert.equal(vm.runInNewContext(cleanup,context),'removed');
 assert.equal(removed,1);
 assert.equal(listener,undefined);
});

test('RG-05 direct USER_SCRIPT message receiver refuses other origins and runtime identities',async()=>{
 const api=await import('../../scripts/violentmonkey-direct-chrome-control.ts');
 const install=api.buildDirectChromeUserScriptListenerInstallation(site);
 const context:any={location:{href:options},window:{},JSON,chrome:{
  runtime:{id:extension,onUserScriptMessage:{addListener(fn:any){context.listener=fn;},removeListener(){} }},
 }};
 assert.equal(vm.runInNewContext(install,context),'attached');
 for(const sender of [
  {id:'different-extension',url:site},
  {id:extension,url:'https://private.invalid/rg05-direct-control'},
  {id:extension,url:site+'?secret=yes'},
 ]){
  let called=false;
  context.listener({kind:'usshm-rg05-direct-v1'},sender,()=>{called=true;});
  assert.equal(called,false,'non-pinned sender must never receive a reply');
 }
 for(const unsafe of [
  'https://private.invalid/rg05-direct-control',
  'http://foo:pass@127.0.0.1:32123/rg05-direct-control',
  site+'?secret=value',
 ]){
  assert.throws(()=>api.buildDirectChromeUserScriptListenerInstallation(unsafe),
   /Invalid isolated direct Chrome control URL/);
 }
 const foreign={location:{href:'chrome-extension://other/page'},window:{},JSON,chrome:{runtime:{
  id:'other',onUserScriptMessage:{addListener(){throw Error('should not add');}},
 }}};
 assert.equal(vm.runInNewContext(install,foreign),'unavailable');
});

test('RG-05 roundtrip listener is installed before fresh document and removed in finally',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const fn=source.indexOf('async function runDirectChromeUserScriptDiagnostic(');
 const end=source.indexOf('const POST_BLOCKER_RELOAD_STAGES',fn);
 const body=source.slice(fn,end);
 const attach=body.indexOf('buildDirectChromeUserScriptListenerInstallation(');
 const create=body.indexOf("Target.createTarget',{url:controlUrl}");
 const detach=body.indexOf('buildDirectChromeUserScriptListenerRemoval(');
 const close=body.indexOf('Target.closeTarget');
 assert.ok(fn>=0&&attach>=0&&create>attach,'listener must precede the synthetic page');
 assert.ok(detach>create&&detach>close,'listener must be detached in cleanup');
 assert.match(body,/roundtrip/);
 assert.ok(source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)')>source.indexOf('const directUserScript=await runDirectChromeUserScriptDiagnostic('));
});

test('RG-05 direct USER_SCRIPT accepts a real callback-only runtime.sendMessage reply',async()=>{
 const api=await import('../../scripts/violentmonkey-direct-chrome-control.ts');
 let owned:any;
 const extensionContext:any={
  location:{href:options},window:{},JSON,
  chrome:{runtime:{id:extension},userScripts:{
   ...worldApi(),
   async getScripts(){return owned?[owned]:[];},
   async register(xs:any[]){owned=xs[0];},
   async unregister(){owned=undefined;},
  }},
 };
 assert.equal(await vm.runInNewContext(api.buildDirectChromeUserScriptRegistration(site),extensionContext),'registered');
 const run=(reply:any)=>{
  const fields:Record<string,string>={};
  const world={location:{href:site},document:{
   documentElement:{setAttribute(k:string,v:string){fields[k]=v;}},
  },chrome:{runtime:{
   sendMessage(request:any,callback:(value:any)=>void){
    assert.equal(request.kind,'usshm-rg05-direct-v1');
    assert.equal(typeof callback,'function','Chrome callback-only USER_SCRIPT API requires reply callback');
    callback(reply);
    return undefined; // Valid callback API: no Promise object.
   },
   onMessage:{addListener(){}},
  }}};
  vm.runInNewContext(owned.js[0].code,world);
  return fields;
 };
 assert.equal(run({kind:'usshm-rg05-direct-v1-response'})['data-usshm-rg05-direct-roundtrip'],
  'verified','a genuine callback reply must count as a synthetic USER_SCRIPT roundtrip');
 assert.notEqual(run({kind:'unrelated'})['data-usshm-rg05-direct-roundtrip'],
  'verified','unknown callback replies must not count');
});
