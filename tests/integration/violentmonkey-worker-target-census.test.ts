import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

const official='jinjaccalgkegednnccohejagnlnfdag';
const ownUrl='chrome-extension://'+official+'/background.js';
const otherUrl='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/background.js';
async function summarize(response:unknown){
 const module=await import('../../scripts/violentmonkey-worker-target-evidence.ts').catch(()=>({} as Record<string,unknown>));
 const fn=(module as any).summarizeOfficialManagerWorkerTargets;
 assert.equal(typeof fn,'function','RG-05 pinned official worker census missing');
 return fn(response) as any;
}

test('RG-05 counts ONLY pinned official service workers and background pages without target URLs',async()=>{
 const data=await summarize({targetInfos:[
  {type:'service_worker',url:ownUrl},
  {type:'background_page',url:'chrome-extension://'+official+'/background.html'},
  {type:'service_worker',url:otherUrl},
  {type:'page',url:ownUrl},
  {type:'service_worker',url:'http://127.0.0.1:1234/fixture'},
 ]});
 assert.deepEqual(data,{status:'observed',serviceWorkers:1,backgroundPages:1});
 assert.doesNotMatch(JSON.stringify(data),/chrome-extension|127|jinjacc/);
 assert.equal(JSON.stringify(data).includes('background.js'),false);
 assert.equal(Object.isFrozen(data),true);
});

test('RG-05 empty Chrome snapshot is observed zero, not proof of broken manager messaging',async()=>{
 assert.deepEqual(await summarize({targetInfos:[]}),{
  status:'observed',serviceWorkers:0,backgroundPages:0,
 });
 assert.deepEqual(await summarize(null),{
  status:'unavailable',serviceWorkers:null,backgroundPages:null,
 });
});

test('RG-05 inherited or accessor-backed top-level targetInfos cannot fabricate worker evidence',async()=>{
 let calls=0;
 const inherited=Object.create({targetInfos:[{type:'service_worker',url:ownUrl}]});
 assert.equal((await summarize(inherited)).status,'unavailable');
 const malicious={};
 Object.defineProperty(malicious,'targetInfos',{get(){calls++;throw Error('PRIVATE_WORKER_TARGETS');}});
 assert.equal((await summarize(malicious)).status,'unavailable');
 assert.equal(calls,0);
});

test('RG-05 accessor-backed target type/url cannot run getters and malformed target snapshots fail closed',async()=>{
 let calls=0;
 const malicious={type:'service_worker'} as Record<string,unknown>;
 Object.defineProperty(malicious,'url',{get(){calls++;throw Error('PRIVATE_MANAGER_TARGET');}});
 for(const targetInfos of [[malicious],new Array(1),[Object.create({type:'service_worker',url:ownUrl})],
   Array.from({length:513},()=>({type:'page',url:''}))]){
  const value=await summarize({targetInfos});
  assert.deepEqual(value,{status:'unavailable',serviceWorkers:null,backgroundPages:null});
 }
 assert.equal(calls,0);
});


test('RG-05 CDP protocol errors cannot authenticate a worker census',async()=>{
 const valid=[{type:'service_worker',url:ownUrl}];
 // Chrome protocol faults must never be promoted from a success-shaped
 // target inventory, even when the error field has a falsy value.
 for(const error of [null,false,0,'',{code:-32000,message:'Private target error'}]){
  const receipt=await summarize({targetInfos:valid,error});
  assert.deepEqual(receipt,{status:'unavailable',serviceWorkers:null,backgroundPages:null});
 }
 for(const fault of [
  {targetInfos:valid,exceptionDetails:null},
  Object.assign(Object.create({error:undefined}),{targetInfos:valid}),
 ]){
  assert.deepEqual(await summarize(fault),{
   status:'unavailable',serviceWorkers:null,backgroundPages:null,
  });
 }
 let getterCalled=0;
 const malicious={targetInfos:valid};
 Object.defineProperty(malicious,'error',{get(){getterCalled++;throw Error('PRIVATE_TARGET_ERROR');}});
 assert.equal((await summarize(malicious)).status,'unavailable');
 assert.equal(getterCalled,0);
});

test('RG-05 revoked target list proxy must fail closed without throwing',async()=>{
 const hostile=Proxy.revocable([],{});hostile.revoke();
 assert.deepEqual(await summarize({targetInfos:hostile.proxy}),{
  status:'unavailable',serviceWorkers:null,backgroundPages:null,
 });
});

test('RG-05 official worker census is passive post-GM only and never substitutes for manager gate',async()=>{
 const script=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 assert.match(script,/summarizeOfficialManagerWorkerTargets/);
 assert.ok(script.includes('Target.getTargets'));
 assert.match(script,/RG-05 official worker targets after two REAL GM receipts:/);
 assert.match(script,/RG-05 official worker targets after first missing cold-start GM receipt:/);
 assert.match(script,/RG-05 official worker targets after two absent GM receipts:/);
 assert.ok(script.indexOf('RG-05 official worker targets after two REAL GM receipts:')<
   script.indexOf('const previousChromePid=chrome.pid'));
 assert.ok(script.indexOf('RG-05 official worker targets after first missing cold-start GM receipt:')>
   script.indexOf('if(!(error instanceof Error)||'));
 assert.ok(script.indexOf('RG-05 official worker targets after two absent GM receipts:')>
   script.indexOf('if(startupInjectionBlocked){'));
 assert.ok(script.includes('assertOfficialViolentmonkeyReleaseGate(blocked.status)'));
});

test('RG-05 post-blocker worker connect probe is exact-extension, payload-free, and never a GM receipt',async()=>{
 const {runInNewContext}=await import('node:vm');
 const module=await import('../../scripts/violentmonkey-worker-target-evidence.ts');
 const builder=(module as Record<string,unknown>).buildOfficialManagerPostBlockerWorkerWakeExpression;
 assert.equal(typeof builder,'function','post-blocker worker wake expression must be available');
 const expression=(builder as ()=>string)();
 assert.equal(typeof expression,'string');
 assert.ok(expression.length<1800,'only one bounded fixed diagnostic expression is permitted');
 assert.doesNotMatch(expression,/GM_getValue|GM_setValue|GetInjected|eval\(|postMessage|chrome\.tabs|chrome\.scripting|register\(|unregister\(|configureWorld|resetWorldConfiguration/,
  'the probe cannot run userscripts, carry messages or modify manager configuration');
 const prefix='chrome-extension://jinjaccalgkegednnccohejagnlnfdag/options/index.html#settings';
 let opened=0,closed=0;
 const chrome={runtime:{id:official,connect(options:{name:string}){
  opened++;
  assert.equal(options.name,'usshm-rg05-worker-wake-only-v1');
  assert.deepEqual(Object.keys(options),['name']);
  return {disconnect(){closed++;}};
 }}};
 const evaluate=(href:string,providedChrome:unknown)=>
  runInNewContext(expression,{location:{href},chrome:providedChrome});
 const authorized=JSON.parse(await evaluate(prefix,chrome));
 assert.deepEqual(authorized,{pinnedContext:true,portOpened:true,portDisconnected:true});
 assert.equal(opened,1);assert.equal(closed,1);
 for(const context of [
  {href:'https://example.invalid/',chrome},
  {href:prefix,chrome:{runtime:{...chrome.runtime,id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}}},
  {href:prefix,chrome:{runtime:{id:official}}},
 ]){
  const denied=JSON.parse(await evaluate(context.href,context.chrome));
  assert.deepEqual(denied,{pinnedContext:false,portOpened:false,portDisconnected:false});
 }
 const aborted=JSON.parse(await evaluate(prefix,{runtime:{id:official,connect(){
  return {disconnect(){throw new Error('PRIVATE_DISCONNECT_EXCEPTION');}};
 }}}));
 assert.deepEqual(aborted,{pinnedContext:true,portOpened:true,portDisconnected:false},
  'a failed disconnect must be fixed-status only; no private exception text escapes');
 assert.equal(opened,1,'no other context may open a runtime port');
});

test('RG-05 worker wake-only experiment runs strictly after immutable official GM blocker',async()=>{
 const script=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const blocked=script.indexOf('assert.equal(blocked.productionEligible,false)');
 const wake=script.indexOf('RG-05 post-blocker worker wake-only diagnostic:');
 const extensionReload=script.indexOf('runPostBlockerExtensionReloadDiagnostic({');
 assert.ok(blocked>=0&&wake>blocked&&extensionReload>wake,
  'a post-blocker connection must not prewarm GM or change the upstream release verdict');
 assert.match(script,/buildOfficialManagerPostBlockerWorkerWakeExpression/);
 assert.match(script,/readOfficialWorkerCensus\(browserCdp\)/);
 assert.match(script,/assertOfficialViolentmonkeyReleaseGate\(blocked.status\)/);
});
