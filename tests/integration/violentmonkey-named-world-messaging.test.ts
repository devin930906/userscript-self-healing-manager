import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {
 buildDirectChromeUserScriptRegistration,
 buildDirectChromeUserScriptRemoval,
} from '../../scripts/violentmonkey-direct-chrome-control.ts';

const extension='jinjaccalgkegednnccohejagnlnfdag';
const options='chrome-extension://'+extension+'/options/index.html#settings';
const site='http://127.0.0.1:32123/rg05-direct-control';
const namedWorld='usshm-rg05-direct-control-world-v1';

test('RG-05 direct diagnostic uses a dedicated messaging-enabled USER_SCRIPT world and restores it',async()=>{
 let registered:any,configured:any,reset=0;
 const api={
  async getWorldConfigurations(){return configured?[{worldId:namedWorld,messaging:true}]:[];},
  async configureWorld(config:any){
   assert.deepEqual(JSON.parse(JSON.stringify(config)),{worldId:namedWorld,messaging:true});
   configured=config;
  },
  async resetWorldConfiguration(worldId:string){assert.equal(worldId,namedWorld);configured=undefined;reset++;},
  async getScripts(){return registered?[registered]:[];},
  async register(entries:any[]){registered=entries[0];},
  async unregister(){registered=undefined;},
 };
 const context={location:{href:options},chrome:{runtime:{id:extension},userScripts:api},JSON};
 assert.equal(await vm.runInNewContext(buildDirectChromeUserScriptRegistration(site),context),'registered');
 assert.equal(registered.world,'USER_SCRIPT');
 assert.equal(registered.worldId,namedWorld,'control must not share the manager default world');
 assert.equal(configured?.messaging,true,'dedicated user-script channel must be explicitly enabled');
 assert.equal(await vm.runInNewContext(buildDirectChromeUserScriptRemoval(),context),'removed');
 assert.equal(reset,1,'only the disposable named world must be reset on cleanup');
 assert.equal(configured,undefined);
});

test('RG-05 refuses preexisting named-world configuration without mutating manager settings',async()=>{
 let configured=0,registered=0,reset=0;
 const context={location:{href:options},JSON,chrome:{runtime:{id:extension},userScripts:{
  async getWorldConfigurations(){return [{worldId:namedWorld,messaging:false}];},
  async configureWorld(){configured++;},
  async resetWorldConfiguration(){reset++;},
  async getScripts(){return [];},
  async register(){registered++;},
 }}}; 
 assert.equal(await vm.runInNewContext(buildDirectChromeUserScriptRegistration(site),context),'unavailable');
 assert.equal(configured,0);
 assert.equal(registered,0);
 assert.equal(reset,0);
});
