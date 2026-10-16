import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const site='http://127.0.0.1:32123/rg05-direct-control';
const extension='jinjaccalgkegednnccohejagnlnfdag';
const options='chrome-extension://'+extension+'/options/index.html#settings';
const id='usshm-rg05-disposable-default-control-v1';

test('RG-05 direct DEFAULT USER_SCRIPT control uses existing messaging world without reconfiguration',async()=>{
 const api:any=await import('../../scripts/violentmonkey-direct-chrome-control.ts');
 assert.equal(typeof api.buildDirectChromeDefaultWorldRegistration,'function');
 assert.equal(typeof api.buildDirectChromeDefaultWorldRemoval,'function');
 let registered:any,configChanged=0,removed=0;
 const context={location:{href:options},JSON,chrome:{runtime:{id:extension},userScripts:{
  async getWorldConfigurations(){return [{worldId:'',messaging:true,csp:'official-manager-owned'}];},
  async getScripts(q:any){
   assert.deepEqual(JSON.parse(JSON.stringify(q)),{ids:[id]});
   return registered?[registered]:[];
  },
  async configureWorld(){configChanged++;},
  async resetWorldConfiguration(){configChanged++;},
  async register(items:any[]){
   assert.equal(items.length,1);
   registered=items[0];
  },
  async unregister(q:any){
   assert.deepEqual(JSON.parse(JSON.stringify(q)),{ids:[id]});
   removed++;registered=undefined;
  },
 }}};
 assert.equal(await vm.runInNewContext(api.buildDirectChromeDefaultWorldRegistration(site),context),'registered');
 assert.equal(registered.id,id);
 assert.equal(registered.world,'USER_SCRIPT');
 assert.ok(!Object.hasOwn(registered,'worldId'),'default world selection must not create a named world');
 assert.equal(registered.allFrames,false);
 assert.equal(registered.runAt,'document_idle');
 assert.ok(registered.js[0].code.includes(site));
 assert.equal(configChanged,0,'must not modify official VM default-world messaging or CSP');
 assert.equal(await vm.runInNewContext(api.buildDirectChromeDefaultWorldRemoval(),context),'removed');
 assert.equal(removed,1);
 assert.equal(configChanged,0);
});

test('RG-05 default-world control refuses disabled default messaging and refuses preexisting ID',async()=>{
 const api:any=await import('../../scripts/violentmonkey-direct-chrome-control.ts');
 let registered=0,unregistered=0,worldWrites=0;
 const world:any={worldId:'',messaging:false};
 const scripts:any[]=[];
 const context={location:{href:options},JSON,chrome:{runtime:{id:extension},userScripts:{
  async getWorldConfigurations(){return [world];},
  async getScripts(){return scripts;},
  async register(){registered++;},
  async unregister(){unregistered++;},
  async configureWorld(){worldWrites++;},
  async resetWorldConfiguration(){worldWrites++;},
 }}};
 assert.equal(await vm.runInNewContext(api.buildDirectChromeDefaultWorldRegistration(site),context),'unavailable');
 assert.equal(registered,0);assert.equal(unregistered,0);assert.equal(worldWrites,0);
 world.messaging=true;
 scripts.push({id});
 assert.equal(await vm.runInNewContext(api.buildDirectChromeDefaultWorldRegistration(site),context),'unavailable');
 assert.equal(registered,0);assert.equal(unregistered,0);assert.equal(worldWrites,0);
});

test('RG-05 default-world readback mismatch uninstalls only its synthetic registration',async()=>{
 const api:any=await import('../../scripts/violentmonkey-direct-chrome-control.ts');
 let created:any,read=0,unregistered=0,configurationWrites=0;
 const context={location:{href:options},JSON,chrome:{runtime:{id:extension},userScripts:{
  async getWorldConfigurations(){return [{messaging:true,worldId:''}];},
  async getScripts(){return ++read===1?[]:[{...created,world:'MAIN'}];},
  async register(items:any[]){created=items[0];},
  async unregister(q:any){assert.deepEqual(JSON.parse(JSON.stringify(q)),{ids:[id]});unregistered++;},
  async configureWorld(){configurationWrites++;},
  async resetWorldConfiguration(){configurationWrites++;},
 }}};
 assert.equal(await vm.runInNewContext(api.buildDirectChromeDefaultWorldRegistration(site),context),'unavailable');
 assert.equal(unregistered,1);
 assert.equal(configurationWrites,0);
});

test('RG-05 actual default world Chrome experiment follows named-world control and precedes hard GM release rejection',async()=>{
 const body=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const classified=body.indexOf('const blocked=classifyOfficialViolentmonkeyRestartBlocker({');
 const dedicated=body.indexOf('const directUserScript=await runDirectChromeUserScriptDiagnostic({');
 const defaultControl=body.indexOf('const defaultUserScript=await runDirectChromeUserScriptDiagnostic({');
 const gate=body.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(classified>=0&&dedicated>classified&&defaultControl>dedicated&&gate>defaultControl);
 assert.match(body,/RG-05 Chrome default USER_SCRIPT after failed official manager cold start/);
});
