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
   ?JSON.stringify({readyMarker:true,webBootstrap:false,officialRuntimeId:true,runtimeOnMessageAvailable:true})
   :JSON.stringify({readyMarker:false,webBootstrap:true,officialRuntimeId:false,runtimeOnMessageAvailable:false})}};
 });
 assert.deepEqual(ids,[21,22]);
 assert.deepEqual(receipt,{
  isolatedWorldsObserved:2,worldsChecked:2,
  readyMarkerObserved:true,webBootstrapObserved:true,officialRuntimeIdObserved:true,
  runtimeOnMessageAvailableObserved:true,sameWorldRuntimeReadyObserved:true,observationIncomplete:false,
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
  readyMarkerObserved:false,webBootstrapObserved:false,officialRuntimeIdObserved:false,
  runtimeOnMessageAvailableObserved:false,sameWorldRuntimeReadyObserved:false,observationIncomplete:true,
 });
 e.observe('Runtime.executionContextsCleared',{});
 const empty=await e.read(async()=>{throw Error('must not inspect a cleared context');});
 assert.deepEqual(empty,{
  isolatedWorldsObserved:0,worldsChecked:0,
  readyMarkerObserved:false,webBootstrapObserved:false,officialRuntimeIdObserved:false,
  runtimeOnMessageAvailableObserved:false,sameWorldRuntimeReadyObserved:false,observationIncomplete:true,
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
 const positives='{"readyMarker":true,"webBootstrap":true,"officialRuntimeId":true,"runtimeOnMessageAvailable":true}';
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
   readyMarkerObserved:false,webBootstrapObserved:false,officialRuntimeIdObserved:false,
  runtimeOnMessageAvailableObserved:false,sameWorldRuntimeReadyObserved:false,observationIncomplete:true,
  });
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_BROWSER_ERROR|pinned|23/);
 }
});


test('RG-05 official runtime identity diagnostic is only a pinned boolean with no extension ID disclosure',async()=>{
 const src=await readFile('scripts/violentmonkey-bootstrap-marker-evidence.ts','utf8');
 assert.match(src,/chrome\.runtime/);
 assert.match(src,/runtime\.onMessage/);
 assert.match(src,/addListener/);
 assert.match(src,/jinjaccalgkegednnccohejagnlnfdag/);
 assert.doesNotMatch(src,/GetInjected\s*\(|\.getScriptSource\s*\(/);
 const e=factory('frame');
 e.observe('Runtime.executionContextCreated',{context:{id:91,auxData:{frameId:'frame',isDefault:false}}});
 const values=await e.read(async()=>({result:{value:JSON.stringify({
  readyMarker:false,webBootstrap:true,officialRuntimeId:true,runtimeOnMessageAvailable:true,
 })}}));
 assert.deepEqual(values,{
  isolatedWorldsObserved:1,worldsChecked:1,
  readyMarkerObserved:false,webBootstrapObserved:true,
  officialRuntimeIdObserved:true,runtimeOnMessageAvailableObserved:true,sameWorldRuntimeReadyObserved:false,observationIncomplete:false,
 });
 assert.doesNotMatch(JSON.stringify(values),/jinjaccalgkegednnccohejagnlnfdag|91|frame/);
});


test('RG-05 observes bounded isolated-world runtime exceptions without retaining private error text',()=>{
 const exceptionFactory=(module as Record<string,unknown>).createPinnedIsolatedRuntimeExceptionEvidence as
  ((frameId:string)=>{observe:(method:string,params:unknown)=>void;snapshot:()=>unknown});
 assert.equal(typeof exceptionFactory,'function','missing RG-05 passive runtime exception observer');
 const evidence=exceptionFactory('pinned');
 evidence.observe('Runtime.executionContextCreated',{context:{id:101,auxData:{frameId:'other',isDefault:false}}});
 evidence.observe('Runtime.executionContextCreated',{context:{id:102,auxData:{frameId:'pinned',isDefault:true}}});
 evidence.observe('Runtime.executionContextCreated',{context:{id:103,auxData:{frameId:'pinned',isDefault:false}}});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:101,text:'PRIVATE_OTHER_SITE'}});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:102,text:'PRIVATE_MAIN_FRAME'}});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:103,text:'PRIVATE_VM_STACK',exception:{description:'PRIVATE_SCRIPT_SOURCE'}}});
 assert.deepEqual(evidence.snapshot(),{
  isolatedExceptionObserved:true,isolatedExceptionCount:1,observationIncomplete:false,
 });
 assert.doesNotMatch(JSON.stringify(evidence.snapshot()),/PRIVATE|pinned|101|102|103|chrome-extension/i);
 evidence.observe('Runtime.executionContextDestroyed',{executionContextId:103});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:103,text:'PRIVATE_STALE'}});
 assert.equal((evidence.snapshot() as {isolatedExceptionCount:number}).isolatedExceptionCount,1);
});

test('RG-05 exception evidence caps volume and is collected without changing GM cold restart gates',async()=>{
 const exceptionFactory=(module as Record<string,unknown>).createPinnedIsolatedRuntimeExceptionEvidence as
  ((frameId:string)=>{observe:(method:string,params:unknown)=>void;snapshot:()=>unknown});
 assert.equal(typeof exceptionFactory,'function');
 const evidence=exceptionFactory('fixture');
 evidence.observe('Runtime.executionContextCreated',{context:{id:9,auxData:{frameId:'fixture',isDefault:false}}});
 for(let i=0;i<20;i++){
  evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:9,text:'PRIVATE_TOKEN_'+i}});
 }
 assert.deepEqual(evidence.snapshot(),{
  isolatedExceptionObserved:true,isolatedExceptionCount:8,observationIncomplete:true,
 });
 evidence.observe('Runtime.executionContextsCleared',{});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:9,text:'PRIVATE_EXPIRED'}});
 assert.equal((evidence.snapshot() as {isolatedExceptionCount:number}).isolatedExceptionCount,8);
 assert.throws(()=>exceptionFactory(''),/frame|identity/i);
 const harness=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 assert.match(harness,/Runtime\.exceptionThrown/,'CDP transport must forward the actual Runtime event');
 assert.match(harness,/createPinnedIsolatedRuntimeExceptionEvidence/);
 const failed=harness.indexOf('startupInjectionBlocked=true');
 const summary=harness.indexOf('RG-05 isolated runtime exceptions after missing GM receipts');
 const gate=harness.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(failed>=0&&summary>failed&&summary<gate,
  'exception classification must only report after BOTH already-failed documents');
 assert.doesNotMatch(harness,/GetInjected\W*\(/,'diagnostic cannot invoke the official manager injection command');
});

test('RG-05 bootstrap readiness cannot be assembled from unrelated isolated execution worlds',async()=>{
 const probe=factory('synthetic-frame');
 probe.observe('Runtime.executionContextCreated',{context:{id:31,auxData:{frameId:'synthetic-frame',isDefault:false}}});
 probe.observe('Runtime.executionContextCreated',{context:{id:32,auxData:{frameId:'synthetic-frame',isDefault:false}}});
 const payload=(readyMarker:boolean,officialRuntimeId:boolean,runtimeOnMessageAvailable:boolean)=>({
  result:{value:JSON.stringify({readyMarker,webBootstrap:false,officialRuntimeId,runtimeOnMessageAvailable})},
 });
 const result=await probe.read(async(_method,params)=>
  params.contextId===31?payload(true,false,false):payload(false,true,true));
 assert.equal((result as {readyMarkerObserved:boolean}).readyMarkerObserved,true);
 assert.equal((result as {officialRuntimeIdObserved:boolean}).officialRuntimeIdObserved,true);
 assert.equal((result as {runtimeOnMessageAvailableObserved:boolean}).runtimeOnMessageAvailableObserved,true);
 assert.equal((result as {sameWorldRuntimeReadyObserved?:boolean}).sameWorldRuntimeReadyObserved,false,
  'flags collected in different worlds cannot certify one coherent bootstrap runtime');
 assert.doesNotMatch(JSON.stringify(result),/synthetic-frame|31|32/);
 const valid=await probe.read(async()=>payload(true,true,true));
 assert.equal((valid as {sameWorldRuntimeReadyObserved?:boolean}).sameWorldRuntimeReadyObserved,true);
});

test('RG-05 bootstrap read must discard credentials from a CDP context destroyed during its own read',async()=>{
 for(const change of ['Runtime.executionContextDestroyed','Runtime.executionContextsCleared']){
  const probe=factory('fixture');
  probe.observe('Runtime.executionContextCreated',{context:{id:44,auxData:{frameId:'fixture',isDefault:false}}});
  const result=await probe.read(async(_method,params)=>{
   if(change==='Runtime.executionContextDestroyed')
    probe.observe(change,{executionContextId:params.contextId});
   else probe.observe(change,{});
   return {result:{value:JSON.stringify({
    readyMarker:true,webBootstrap:true,officialRuntimeId:true,runtimeOnMessageAvailable:true,
   })}};
  });
  assert.deepEqual(result,{
   isolatedWorldsObserved:0,worldsChecked:0,
   readyMarkerObserved:false,webBootstrapObserved:false,officialRuntimeIdObserved:false,
   runtimeOnMessageAvailableObserved:false,sameWorldRuntimeReadyObserved:false,
   observationIncomplete:true,
  },'stale response from a removed document must never be counted');
 }
});

test('RG-05 bootstrap world evidence does not trust inherited or getter-backed context lifecycle events',async()=>{
 let getterCalls=0,probes=0;
 const isolated={id:73,auxData:{frameId:'fixture',isDefault:false}};
 const probe=factory('fixture');
 const getterParams={};
 Object.defineProperty(getterParams,'context',{enumerable:true,get(){getterCalls++;return isolated;}});
 for(const event of [
  Object.create({context:isolated}),getterParams,
  {context:Object.create(isolated)},
  {context:{id:74,auxData:Object.create({frameId:'fixture',isDefault:false})}},
 ]){
  assert.doesNotThrow(()=>probe.observe('Runtime.executionContextCreated',event));
 }
 const result=await probe.read(async()=>{probes++;throw new Error('forged context must not be queried');});
 assert.equal(probes,0,'untrusted event metadata must never select an arbitrary CDP execution context');
 assert.equal(getterCalls,0,'must not invoke event accessor getters');
 assert.deepEqual(result,{
  isolatedWorldsObserved:0,worldsChecked:0,
  readyMarkerObserved:false,webBootstrapObserved:false,officialRuntimeIdObserved:false,
  runtimeOnMessageAvailableObserved:false,sameWorldRuntimeReadyObserved:false,
  observationIncomplete:true,
 });
 // A forged destruction event must not erase a valid context either.
 probe.observe('Runtime.executionContextCreated',{context:{id:75,auxData:{frameId:'fixture',isDefault:false}}});
 const forgedDestroy={};
 Object.defineProperty(forgedDestroy,'executionContextId',{enumerable:true,get(){getterCalls++;return 75;}});
 probe.observe('Runtime.executionContextDestroyed',forgedDestroy);
 probe.observe('Runtime.executionContextDestroyed',Object.create({executionContextId:75}));
 const retained=await probe.read(async(_method,params)=>{
  assert.equal(params.contextId,75);
  return {result:{value:JSON.stringify({
   readyMarker:true,webBootstrap:false,officialRuntimeId:true,runtimeOnMessageAvailable:true,
  })}};
 });
 assert.equal(getterCalls,0);
 assert.equal((retained as {sameWorldRuntimeReadyObserved:boolean}).sameWorldRuntimeReadyObserved,true);
});

test('RG-05 passive isolated runtime exception provenance rejects inherited and accessor-backed event fields',()=>{
 const exceptionFactory=(module as Record<string,unknown>).createPinnedIsolatedRuntimeExceptionEvidence as
  ((frameId:string)=>{observe:(method:string,params:unknown)=>void;snapshot:()=>unknown});
 const e=exceptionFactory('fixture');
 let getters=0;
 const context={id:81,auxData:{frameId:'fixture',isDefault:false}};
 const accessor={};
 Object.defineProperty(accessor,'context',{enumerable:true,get(){getters++;return context;}});
 for(const item of [Object.create({context}),accessor,{context:Object.create(context)},
  {context:{id:82,auxData:Object.create({frameId:'fixture',isDefault:false})}}]){
  assert.doesNotThrow(()=>e.observe('Runtime.executionContextCreated',item));
 }
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:81,text:'PRIVATE_TOKEN'}});
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:82,text:'PRIVATE_TOKEN'}});
 assert.deepEqual(e.snapshot(),{
  isolatedExceptionObserved:false,isolatedExceptionCount:0,observationIncomplete:false,
 });
 assert.equal(getters,0);
 e.observe('Runtime.executionContextCreated',{context:{id:83,auxData:{frameId:'fixture',isDefault:false}}});
 const getterException={};
 Object.defineProperty(getterException,'exceptionDetails',{enumerable:true,get(){
  getters++;return {executionContextId:83,text:'PRIVATE_TOKEN'};
 }});
 e.observe('Runtime.exceptionThrown',getterException);
 e.observe('Runtime.exceptionThrown',Object.create({exceptionDetails:{executionContextId:83,text:'PRIVATE_TOKEN'}}));
 e.observe('Runtime.exceptionThrown',{exceptionDetails:Object.create({executionContextId:83})});
 assert.equal(getters,0,'no arbitrary diagnostic exception getters may run');
 assert.deepEqual(e.snapshot(),{
  isolatedExceptionObserved:false,isolatedExceptionCount:0,observationIncomplete:false,
 });
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:83,text:'PRIVATE_TOKEN'}});
 assert.deepEqual(e.snapshot(),{
  isolatedExceptionObserved:true,isolatedExceptionCount:1,observationIncomplete:false,
 });
});

test('RG-05 bootstrap read rejects inherited and accessor CDP result envelopes without executing getters',async()=>{
 const positive=JSON.stringify({
  readyMarker:true,webBootstrap:false,officialRuntimeId:true,runtimeOnMessageAvailable:true,
 });
 let getters=0;
 const getterPacket={};
 Object.defineProperty(getterPacket,'result',{enumerable:true,get(){
  getters++;return {value:positive};
 }});
 const getterValue={};
 Object.defineProperty(getterValue,'value',{enumerable:true,get(){
  getters++;return positive;
 }});
 for(const forged of [
  Object.create({result:{value:positive}}),
  getterPacket,
  {result:Object.create({value:positive})},
  {result:getterValue},
 ]){
  const sample=factory('fixture');
  sample.observe('Runtime.executionContextCreated',{context:{id:66,auxData:{frameId:'fixture',isDefault:false}}});
  const receipt=await sample.read(async()=>forged);
  assert.deepEqual(receipt,{
   isolatedWorldsObserved:1,worldsChecked:0,
   readyMarkerObserved:false,webBootstrapObserved:false,
   officialRuntimeIdObserved:false,runtimeOnMessageAvailableObserved:false,
   sameWorldRuntimeReadyObserved:false,observationIncomplete:true,
  },'malformed CDP result must never certify official runtime readiness');
 }
 assert.equal(getters,0,'CDP receipt accessors must never execute in passive diagnostics');
 const sample=factory('fixture');
 sample.observe('Runtime.executionContextCreated',{context:{id:67,auxData:{frameId:'fixture',isDefault:false}}});
 const genuine=await sample.read(async()=>({result:{value:positive}}));
 assert.equal((genuine as {sameWorldRuntimeReadyObserved:boolean}).sameWorldRuntimeReadyObserved,true);
 assert.equal((genuine as {observationIncomplete:boolean}).observationIncomplete,false);
});


test('RG-05 samples first failed Chrome document bootstrap only after actual missing GM',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const firstMiss=source.indexOf('RG-05 cold-start injection was absent; one isolated loopback reload required');
 const firstBootstrap=source.indexOf('RG-05 first failed Chrome document official bootstrap marker:');
 const reload=source.indexOf("await pageCdp.send('Page.reload',{ignoreCache:true})",firstMiss);
 const secondFail=source.indexOf('startupInjectionBlocked=true',reload);
 const finalDenial=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)',secondFail);
 assert.ok(firstMiss>=0&&firstBootstrap>firstMiss&&reload>firstBootstrap,
  'first-document bootstrap must be sampled after genuine absent GM and before one reload');
 assert.ok(secondFail>reload&&finalDenial>secondFail,
  'first-document passive evidence must never count as official GM or relax failure');
 const slice=source.slice(firstMiss,reload);
 assert.match(slice,/restartedMarkerEvidence\.read\(/);
 assert.doesNotMatch(slice,/GetInjected\s*\(|\.getScriptSource\s*\(|configureWorld\s*\(/);
 assert.match(source,/RG-05 official VM bootstrap marker after missing GM receipts:/,
  'second-document passive diagnostic must remain available');
});
