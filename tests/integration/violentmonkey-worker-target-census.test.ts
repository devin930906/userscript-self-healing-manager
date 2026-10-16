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
 assert.doesNotMatch(JSON.stringify(data),/chrome-extension|127|jinjacc|background/);
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
