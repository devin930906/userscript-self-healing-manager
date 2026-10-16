import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {buildDirectChromeUserScriptRegistration,buildDirectChromeUserScriptRemoval,DIRECT_CONTROL_ID,DIRECT_CONTROL_WORLD_ID} from '../../scripts/violentmonkey-direct-chrome-control.ts';

const site='http://127.0.0.1:32123/rg05-direct-control';
const extension='jinjaccalgkegednnccohejagnlnfdag';
const options='chrome-extension://'+extension+'/options/index.html#settings';

test('RG-05 post-blocker named -> default -> named recheck excludes stale extension listener and cleanup artifacts',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const blocker=source.indexOf('const blocked=classifyOfficialViolentmonkeyRestartBlocker({');
 const first=source.indexOf('const directUserScript=await runDirectChromeUserScriptDiagnostic({');
 const defaultWorld=source.indexOf('const defaultUserScript=await runDirectChromeUserScriptDiagnostic({');
 const replay=source.indexOf('const namedReplayUserScript=await runDirectChromeUserScriptDiagnostic({');
 const mandatory=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(blocker>=0&&first>blocker&&defaultWorld>first&&replay>defaultWorld&&mandatory>replay);
 assert.match(source,/RG-05 Chrome named replay USER_SCRIPT after failed official manager cold start/);
 assert.match(source,/GM acceptance remains blocked/);
});

test('RG-05 named-world synthetic registration remains reversible across two separate A/B/A observations',async()=>{
 const registered:any[]=[];
 let reset=0,configure=0;
 let active=false;
 const api={
  async getScripts(q:any){
   assert.deepEqual(JSON.parse(JSON.stringify(q)),{ids:[DIRECT_CONTROL_ID]});
   return registered;
  },
  async getWorldConfigurations(){
   return active?[{worldId:DIRECT_CONTROL_WORLD_ID,messaging:true}]:[];
  },
  async configureWorld(x:any){
   assert.deepEqual(JSON.parse(JSON.stringify(x)),{worldId:DIRECT_CONTROL_WORLD_ID,messaging:true});
   assert.equal(active,false);active=true;configure++;
  },
  async resetWorldConfiguration(id:string){
   assert.equal(id,DIRECT_CONTROL_WORLD_ID);
   assert.equal(active,true);active=false;reset++;
  },
  async register(entries:any[]){
   assert.equal(active,true);
   registered.push(...entries);
  },
  async unregister(q:any){
   assert.deepEqual(JSON.parse(JSON.stringify(q)),{ids:[DIRECT_CONTROL_ID]});
   registered.length=0;
  },
 };
 const context={location:{href:options},chrome:{runtime:{id:extension},userScripts:api},JSON};
 for(let n=0;n<2;n++){
  assert.equal(await vm.runInNewContext(buildDirectChromeUserScriptRegistration(site),context),'registered');
  assert.equal(registered.length,1);
  assert.equal(await vm.runInNewContext(buildDirectChromeUserScriptRemoval(),context),'removed');
  assert.equal(registered.length,0);
  assert.equal(active,false);
 }
 assert.equal(configure,2);
 assert.equal(reset,2);
});
