import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

const extension='jinjaccalgkegednnccohejagnlnfdag';
const options='chrome-extension://'+extension+'/options/index.html#settings';
const site='http://127.0.0.1:32123/rg05-direct-control';

test('RG-05 distinguish userScript message arrival, trusted sender match and synchronous reply',async()=>{
 const api=await import('../../scripts/violentmonkey-direct-chrome-control.ts');
 assert.equal(typeof api.buildDirectChromeUserScriptListenerObservation,'function');
 const context:any={window:{},location:{href:options},JSON,chrome:{runtime:{
  id:extension,onUserScriptMessage:{
   addListener(fn:any){context.listener=fn;},
   removeListener(){},
  },
 }}};
 const observe=api.buildDirectChromeUserScriptListenerObservation();
 assert.equal(vm.runInNewContext(api.buildDirectChromeUserScriptListenerInstallation(site),context),'attached');
 const initial=JSON.parse(vm.runInNewContext(observe,context));
 assert.deepEqual(initial,{received:false,sourceMatched:false,replied:false});
 // Official manager may send unrelated USER_SCRIPT messages in this context.
 // They must NOT be attributed to our isolated synthetic control.
 context.listener({kind:'official-manager-unrelated'},{
  id:extension,url:site,
 },()=>{throw Error('An unrelated message must never receive a diagnostic reply');});
 assert.deepEqual(JSON.parse(vm.runInNewContext(observe,context)),{
  received:false,sourceMatched:false,replied:false,
 },'unrelated manager message is not evidence our fixed synthetic request arrived');
 let unexpected=false;
 context.listener({kind:'usshm-rg05-direct-v1'},{
  id:extension,url:'https://untrusted.invalid/rg05-direct-control',
 },()=>{unexpected=true;});
 assert.equal(unexpected,false);
 assert.deepEqual(JSON.parse(vm.runInNewContext(observe,context)),{
  received:true,sourceMatched:false,replied:false,
 });
 let authentic:any;
 context.listener({kind:'usshm-rg05-direct-v1'},{
  id:extension,url:site,
 },(reply:any)=>{authentic=reply;});
 assert.equal(authentic?.kind,'usshm-rg05-direct-v1-response');
 assert.deepEqual(JSON.parse(vm.runInNewContext(observe,context)),{
  received:true,sourceMatched:true,replied:true,
 });
 assert.equal(vm.runInNewContext(api.buildDirectChromeUserScriptListenerRemoval(),context),'removed');
 assert.deepEqual(JSON.parse(vm.runInNewContext(observe,context)),{
  received:false,sourceMatched:false,replied:false,
 },'listener state must be unavailable after cleanup');
});

test('RG-05 fixed bounded receiver observations are read before listener removal and never certify GM',async()=>{
 const text=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const begin=text.indexOf('async function runDirectChromeUserScriptDiagnostic(');
 const end=text.indexOf('const POST_BLOCKER_RELOAD_STAGES',begin);
 const body=text.slice(begin,end);
 const observed=body.indexOf('buildDirectChromeUserScriptListenerObservation()');
 const removed=body.indexOf('buildDirectChromeUserScriptListenerRemoval()');
 assert.ok(observed>=0&&removed>observed);
 assert.match(body,/messageReceipt/);
 assert.ok(text.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)')>
  text.indexOf('const directUserScript=await runDirectChromeUserScriptDiagnostic('));
});
