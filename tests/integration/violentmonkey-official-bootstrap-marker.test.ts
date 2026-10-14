import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import * as module from '../../scripts/violentmonkey-bootstrap-marker-evidence.ts';

const factory=(module as Record<string,unknown>).createPinnedBootstrapMarkerEvidence as
 ((frameId:string)=>{observe:(method:string,params:unknown)=>void;
 read:(send:(method:string,params:Record<string,unknown>)=>Promise<unknown>)=>Promise<unknown>});

test('RG-05 fixed VM bootstrap marker probes only the exact disposable fixture isolated contexts',async()=>{
 assert.equal(typeof factory,'function','missing bounded upstream bootstrap marker diagnostic');
 const e=factory('pinned-frame');
 e.observe('Runtime.executionContextCreated',{context:{id:17,auxData:{frameId:'other-frame',isDefault:false}}});
 e.observe('Runtime.executionContextCreated',{context:{id:18,auxData:{frameId:'pinned-frame',isDefault:true}}});
 e.observe('Runtime.executionContextCreated',{context:{id:21,auxData:{frameId:'pinned-frame',isDefault:false}}});
 e.observe('Runtime.executionContextCreated',{context:{id:22,auxData:{frameId:'pinned-frame',isDefault:false}}});
 const ids:number[]=[];
 const receipt=await e.read(async(method,params)=>{
  assert.equal(method,'Runtime.evaluate');
  assert.equal(params.returnByValue,true);
  assert.equal(params.awaitPromise,false);
  assert.equal(typeof params.expression,'string');
  assert.match(params.expression as string,/\*\*VMInitInjection\*\*/);
  assert.doesNotMatch(params.expression as string,/\beval\(|Function\(|getScriptSource|\.innerHTML|\.cookie|localStorage/);
  ids.push(params.contextId as number);
  return {result:{value:params.contextId===21
   ?JSON.stringify({readyMarker:true,webBootstrap:false,officialRuntimeId:true})
   :JSON.stringify({readyMarker:false,webBootstrap:true,officialRuntimeId:false})}};
 });
 assert.deepEqual(ids,[21,22]);
 assert.deepEqual(receipt,{
  isolatedWorldsObserved:2,worldsChecked:2,
  readyMarkerObserved:true,webBootstrapObserved:true,officialRuntimeIdObserved:true,observationIncomplete:false,
 });
 assert.doesNotMatch(JSON.stringify(receipt),/pinned-frame|VMInitInjection|21|22|private/i);
});

test('RG-05 marker probe excludes destroyed/cleared worlds and fails closed for corrupted CDP data',async()=>{
 const e=factory('frame');
 for(const [id,aux] of [[3,{frameId:'frame',isDefault:false}],[4,{frameId:'frame',isDefault:false}],
    [5,{frameId:'wrong',isDefault:false}],[6,{frameId:'frame',isDefault:'false'}]] as const){
  e.observe('Runtime.executionContextCreated',{context:{id,auxData:aux}});
 }
 e.observe('Runtime.executionContextDestroyed',{executionContextId:3});
 const seen:number[]=[];
 const result=await e.read(async(_method,params)=>{
  seen.push(params.contextId as number);
  return {error:{message:'private browser data must not escape'},result:{value:'{"readyMarker":true,"webBootstrap":true}'}};
 });
 assert.deepEqual(seen,[4]);
 assert.deepEqual(result,{
  isolatedWorldsObserved:1,worldsChecked:0,
  readyMarkerObserved:false,webBootstrapObserved:false,officialRuntimeIdObserved:false,observationIncomplete:true,
 });
 e.observe('Runtime.executionContextsCleared',{});
 const empty=await e.read(async()=>{throw Error('must not inspect a cleared context');});
 assert.deepEqual(empty,{
  isolatedWorldsObserved:0,worldsChecked:0,
  readyMarkerObserved:false,webBootstrapObserved:false,officialRuntimeIdObserved:false,observationIncomplete:true,
 });
 for(const bad of ['', 'x'.repeat(257)])assert.throws(()=>factory(bad),/frame|identity/i);
});

test('RG-05 marker sampling is post-GM only and cannot prewarm the cold-start acceptance',async()=>{
 const harness=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const controlStart=harness.indexOf('RG-05 official VM bootstrap marker control');
 const controlReceipt=harness.indexOf('const secondReceipt=assertViolentmonkeyV4FixtureObservation');
 const browserClose=harness.indexOf("browserCdp.send('Browser.close')");
 const failedBoth=harness.indexOf('startupInjectionBlocked=true');
 const post=harness.indexOf('RG-05 official VM bootstrap marker after missing GM receipts');
 const gate=harness.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(controlStart>controlReceipt&&controlStart<browserClose,
  'bootstrap control is read only after two genuine GM receipts');
 assert.ok(post>failedBoth&&post<gate,'post-restart probe only after two already-failed GM pages');
 assert.match(harness,/Runtime\.executionContextDestroyed/);
 assert.match(harness,/Runtime\.executionContextsCleared/);
 assert.match(harness,/assertOfficialViolentmonkeyReleaseGate\(blocked.status\)/);
 assert.doesNotMatch(harness,/GetInjected\W*\(/,'never invoke upstream mutating GetInjected as diagnostic');
});


test('RG-05 marker never accepts nested CDP exception and error envelopes that also forge a positive boolean',async()=>{
 const positives='{"readyMarker":true,"webBootstrap":true,"officialRuntimeId":true}';
 for(const payload of [
  {result:{value:positives,exceptionDetails:{text:'PRIVATE_BROWSER_ERROR'}}},
  {result:{value:positives,error:{message:'PRIVATE_BROWSER_ERROR'}}},
  {result:{value:positives,exceptionDetails:null}},
 ]){
  const evidence=factory('pinned');
  evidence.observe('Runtime.executionContextCreated',{
   context:{id:23,auxData:{frameId:'pinned',isDefault:false}},
  });
  const result=await evidence.read(async()=>payload);
  assert.deepEqual(result,{
   isolatedWorldsObserved:1,worldsChecked:0,
   readyMarkerObserved:false,webBootstrapObserved:false,officialRuntimeIdObserved:false,observationIncomplete:true,
  });
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_BROWSER_ERROR|pinned|23/);
 }
});


test('RG-05 official runtime identity diagnostic is only a pinned boolean with no extension ID disclosure',async()=>{
 const src=await readFile('scripts/violentmonkey-bootstrap-marker-evidence.ts','utf8');
 assert.match(src,/chrome\.runtime/);
 assert.match(src,/jinjaccalgkegednnccohejagnlnfdag/);
 assert.doesNotMatch(src,/GetInjected\s*\(|\.getScriptSource\s*\(/);
 const e=factory('frame');
 e.observe('Runtime.executionContextCreated',{context:{id:91,auxData:{frameId:'frame',isDefault:false}}});
 const values=await e.read(async()=>({result:{value:JSON.stringify({
  readyMarker:false,webBootstrap:true,officialRuntimeId:true,
 })}}));
 assert.deepEqual(values,{
  isolatedWorldsObserved:1,worldsChecked:1,
  readyMarkerObserved:false,webBootstrapObserved:true,
  officialRuntimeIdObserved:true,observationIncomplete:false,
 });
 assert.doesNotMatch(JSON.stringify(values),/jinjaccalgkegednnccohejagnlnfdag|91|frame/);
});
