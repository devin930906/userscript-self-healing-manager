import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';
import {
 buildDirectChromeUserScriptRegistration,
 buildDirectChromeUserScriptRemoval,
 DIRECT_CONTROL_ID,
} from '../../scripts/violentmonkey-direct-chrome-control.ts';

const site='http://127.0.0.1:32123/rg05-direct-control';
const extension='jinjaccalgkegednnccohejagnlnfdag';
const options='chrome-extension://'+extension+'/options/index.html#settings';

test('RG-05 direct Chrome userScripts control registers only fixed loopback script in USER_SCRIPT world',async()=>{
 const registry:any[]=[];
 const api={
  async getScripts(query:any){assert.deepEqual(JSON.parse(JSON.stringify(query)),{ids:[DIRECT_CONTROL_ID]});return registry;},
  async register(scripts:any[]){
   assert.equal(scripts.length,1);
   assert.equal(scripts[0].id,DIRECT_CONTROL_ID);
   assert.deepEqual(JSON.parse(JSON.stringify(scripts[0].matches)),['http://127.0.0.1/rg05-direct-control']);
   assert.ok(scripts[0].js[0].code.includes(site),'injected source must fence the exact port and path');
   assert.equal(scripts[0].world,'USER_SCRIPT');
   assert.equal(scripts[0].runAt,'document_idle');
   assert.equal(scripts[0].js.length,1);
   assert.equal(typeof scripts[0].js[0].code,'string');
   assert.match(scripts[0].js[0].code,/data-usshm-rg05-direct-control/);
   assert.doesNotMatch(scripts[0].js[0].code,/eval\(|GM_getValue|GM_setValue|xmlhttpRequest/);
   registry.push(...scripts);
  },
  async unregister(query:any){assert.deepEqual(JSON.parse(JSON.stringify(query)),{ids:[DIRECT_CONTROL_ID]});registry.length=0;},
 };
 const context={location:{href:options},chrome:{runtime:{id:extension},userScripts:api},JSON};
 const registered=await vm.runInNewContext(buildDirectChromeUserScriptRegistration(site),context);
 assert.equal(registered,'registered');
 assert.equal(registry.length,1);
 // Re-entry must not overwrite the already-owned registration.
 assert.equal(await vm.runInNewContext(buildDirectChromeUserScriptRegistration(site),context),'unavailable');
 assert.equal(registry.length,1);
 assert.equal(await vm.runInNewContext(buildDirectChromeUserScriptRemoval(),context),'removed');
 assert.equal(registry.length,0);
});

test('RG-05 diagnostic refuses untrusted origins and manager identity, without exposing errors',async()=>{
 for(const input of ['https://private.invalid/rg05-direct-control','http://127.0.0.1:32123/fixture',
  'http://user:pass@127.0.0.1:32123/rg05-direct-control',
  'http://127.0.0.1:32123/rg05-direct-control?token=secret']){
  assert.throws(()=>buildDirectChromeUserScriptRegistration(input),/Invalid isolated direct Chrome control URL/);
 }
 let calls=0;
 const result=await vm.runInNewContext(buildDirectChromeUserScriptRegistration(site),{
  location:{href:options},chrome:{runtime:{id:'wrong'},userScripts:{async register(){calls++;}}},JSON,
 });
 assert.equal(result,'unavailable');
 assert.equal(calls,0);
 const privateError='PRIVATE_CHROME_EXTENSION_ERROR';
 const failed=await vm.runInNewContext(buildDirectChromeUserScriptRegistration(site),{
  location:{href:options},chrome:{runtime:{id:extension},userScripts:{
   async getScripts(){throw new Error(privateError);},async register(){calls++;}
  }},JSON,
 });
 assert.equal(failed,'unavailable');
 assert.equal(calls,0);
});


test('RG-05 direct Chrome diagnostic rolls back its registration if readback throws',async()=>{
 let read=0,registered=0,removed=0;
 const text=await vm.runInNewContext(buildDirectChromeUserScriptRegistration(site),{
  location:{href:options},chrome:{runtime:{id:extension},userScripts:{
   async getScripts(){if(++read===1)return [];throw Error('PRIVATE_EXTENSION_READBACK');},
   async register(){registered++;},
   async unregister(query:any){
    assert.deepEqual(JSON.parse(JSON.stringify(query)),{ids:[DIRECT_CONTROL_ID]});
    removed++;
   },
  }},JSON,
 });
 assert.equal(text,'unavailable');
 assert.equal(registered,1);
 assert.equal(removed,1,'a successful registration must be removed when its subsequent receipt fails');
});

test('RG-05 direct Chrome diagnostic rolls back malformed nonmatching registration',async()=>{
 let read=0,removed=0;
 const result=await vm.runInNewContext(buildDirectChromeUserScriptRegistration(site),{
  location:{href:options},chrome:{runtime:{id:extension},userScripts:{
   async getScripts(){return ++read===1?[]:[{id:DIRECT_CONTROL_ID,world:'MAIN',matches:[site]}];},
   async register(){},
   async unregister(){removed++;},
  }},JSON,
 });
 assert.equal(result,'unavailable');
 assert.equal(removed,1);
});

test('RG-05 direct Chrome userscript diagnostic occurs only AFTER the true cold-restart GM blocker',async()=>{
 const text=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const blocker=text.indexOf('const blocked=classifyOfficialViolentmonkeyRestartBlocker({');
 const control=text.indexOf('const directUserScript=await runDirectChromeUserScriptDiagnostic({');
 const gate=text.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(blocker>=0&&control>blocker&&gate>control);
 assert.match(text,/rg05-direct-control/);
 assert.match(text,/NOT an official GM receipt/);
 assert.doesNotMatch(text,/if\s*\([^)]*directUserScript[^)]*\)\s*assertOfficialViolentmonkeyReleaseGate\('fixture-restart-passed'\)/);
});
