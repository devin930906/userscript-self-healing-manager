import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('RG-05 CDP context sampler distinguishes default vs isolated worlds only for exact fixture frame',async()=>{
 const mod=await import('../../scripts/violentmonkey-frame-context-evidence.ts').catch(()=>null);
 assert.equal(typeof mod?.createIsolatedFixtureFrameContextEvidence,'function',
  'missing real-CDP context boundary evidence for isolated official-manager fixture');
 const evidence=mod!.createIsolatedFixtureFrameContextEvidence('fixture-frame-1');
 evidence.observe('Runtime.executionContextCreated',{context:{auxData:{frameId:'other-frame',isDefault:false},
  origin:'https://private.example.invalid/',name:'PRIVATE'}});
 assert.deepEqual(evidence.snapshot(),{defaultContextObserved:false,isolatedContextObserved:false});
 evidence.observe('Runtime.executionContextCreated',{context:{auxData:{frameId:'fixture-frame-1',isDefault:true}}});
 evidence.observe('Runtime.executionContextCreated',{context:{auxData:{frameId:'fixture-frame-1',isDefault:false},
  origin:'chrome-extension://PRIVATE',name:'PRIVATE_CODE'}});
 evidence.observe('Runtime.executionContextCreated',{context:{auxData:{frameId:'fixture-frame-1',isDefault:'false'}}});
 assert.deepEqual(evidence.snapshot(),{defaultContextObserved:true,isolatedContextObserved:true});
 assert.doesNotMatch(JSON.stringify(evidence.snapshot()),/PRIVATE|https?:/);
});

test('RG-05 real Chrome harness observes execution-context events on each pinned fixture page',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 assert.match(source,/createIsolatedFixtureFrameContextEvidence\(identity\.frameId\)/);
 assert.match(source,/createIsolatedFixtureFrameContextEvidence\(afterRestartIdentity\.frameId\)/);
 assert.match(source,/pageCdp=await openCdp\(fixturePage\.webSocketDebuggerUrl,\(method,params\)=>\{/);
 assert.match(source,/initialContextEvidence\.observe\(method,params\)/);
 assert.match(source,/initialMarkerEvidence\.observe\(method,params\)/);
 assert.match(source,/pageCdp=await openCdp\(restartedFixturePage\.webSocketDebuggerUrl,\(method,params\)=>\{/);
 assert.match(source,/restartedContextEvidence\.observe\(method,params\)/);
 assert.match(source,/restartedMarkerEvidence\.observe\(method,params\)/);
 assert.match(source,/Runtime\.executionContextCreated/);
 assert.match(source,/RG-05 initial fixture CDP contexts/);
 assert.match(source,/RG-05 restarted fixture CDP contexts/);
});

test('RG-05 a destroyed or cleared fixture execution context cannot certify a later document',async()=>{
 const mod=await import('../../scripts/violentmonkey-frame-context-evidence.ts');
 const e=mod.createIsolatedFixtureFrameContextEvidence('bounded-fixture');
 e.observe('Runtime.executionContextCreated',{context:{id:41,auxData:{frameId:'bounded-fixture',isDefault:true}}});
 e.observe('Runtime.executionContextCreated',{context:{id:42,auxData:{frameId:'bounded-fixture',isDefault:false}}});
 assert.deepEqual(e.snapshot(),{defaultContextObserved:true,isolatedContextObserved:true});
 e.observe('Runtime.executionContextDestroyed',{executionContextId:42});
 assert.deepEqual(e.snapshot(),{defaultContextObserved:true,isolatedContextObserved:false},
  'a destroyed isolated world is not evidence of a currently live bootstrap');
 e.observe('Runtime.executionContextsCleared',{});
 assert.deepEqual(e.snapshot(),{defaultContextObserved:false,isolatedContextObserved:false},
  'a page reload cannot reuse the previous document context evidence');
 e.observe('Runtime.executionContextCreated',{context:{id:43,auxData:{frameId:'bounded-fixture',isDefault:true}}});
 e.observe('Runtime.executionContextCreated',{context:{auxData:{frameId:'bounded-fixture',isDefault:false}}});
 assert.deepEqual(e.snapshot(),{defaultContextObserved:true,isolatedContextObserved:false},
  'missing context identity cannot certify a new isolated execution world');
 assert.doesNotMatch(JSON.stringify(e.snapshot()),/bounded-fixture|41|42|43|PRIVATE/);
});
