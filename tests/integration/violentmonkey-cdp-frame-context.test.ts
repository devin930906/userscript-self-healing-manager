import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('RG-05 CDP context sampler distinguishes default vs isolated worlds only for exact fixture frame',async()=>{
 const mod=await import('../../scripts/violentmonkey-frame-context-evidence.ts').catch(()=>null);
 assert.equal(typeof mod?.createIsolatedFixtureFrameContextEvidence,'function',
  'missing real-CDP context boundary evidence for isolated official-manager fixture');
 const evidence=mod!.createIsolatedFixtureFrameContextEvidence('fixture-frame-1');
 evidence.observe('Runtime.executionContextCreated',{context:{id:10,auxData:{frameId:'other-frame',isDefault:false},
  origin:'https://private.example.invalid/',name:'PRIVATE'}});
 assert.deepEqual(evidence.snapshot(),{defaultContextObserved:false,isolatedContextObserved:false});
 evidence.observe('Runtime.executionContextCreated',{context:{id:11,auxData:{frameId:'fixture-frame-1',isDefault:true}}});
 evidence.observe('Runtime.executionContextCreated',{context:{id:12,auxData:{frameId:'fixture-frame-1',isDefault:false},
  origin:'chrome-extension://PRIVATE',name:'PRIVATE_CODE'}});
 evidence.observe('Runtime.executionContextCreated',{context:{id:13,auxData:{frameId:'fixture-frame-1',isDefault:'false'}}});
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

test('RG-05 context observer rejects inherited and accessor-backed CDP metadata without evaluating getters',async()=>{
 const {createIsolatedFixtureFrameContextEvidence}=await import('../../scripts/violentmonkey-frame-context-evidence.ts');
 const e=createIsolatedFixtureFrameContextEvidence('bounded-fixture');
 let getters=0;
 const isolated={id:91,auxData:{frameId:'bounded-fixture',isDefault:false}};
 const inherited=Object.create({context:isolated});
 const accessorParams={};
 Object.defineProperty(accessorParams,'context',{enumerable:true,get(){getters++;return isolated;}});
 const accessorContext={id:92};
 Object.defineProperty(accessorContext,'auxData',{enumerable:true,get(){getters++;return isolated.auxData;}});
 const accessorAux={frameId:'bounded-fixture'};
 Object.defineProperty(accessorAux,'isDefault',{enumerable:true,get(){getters++;return false;}});
 for(const event of [
  inherited,
  accessorParams,
  {context:accessorContext},
  {context:{id:93,auxData:accessorAux}},
  {context:{id:94,auxData:Object.create({frameId:'bounded-fixture',isDefault:false})}},
  {context:Object.create({id:95,auxData:isolated.auxData})},
 ]){
  assert.doesNotThrow(()=>e.observe('Runtime.executionContextCreated',event));
  assert.deepEqual(e.snapshot(),{defaultContextObserved:false,isolatedContextObserved:false},
   'invalid or inherited context receipt must not create a false isolated-world observation');
 }
 assert.equal(getters,0,'diagnostic sampling must not execute accessor-backed metadata');
 e.observe('Runtime.executionContextCreated',{context:{id:96,auxData:{frameId:'bounded-fixture',isDefault:false}}});
 assert.deepEqual(e.snapshot(),{defaultContextObserved:false,isolatedContextObserved:true});
 const destroyed={};
 Object.defineProperty(destroyed,'executionContextId',{enumerable:true,get(){getters++;return 96;}});
 assert.doesNotThrow(()=>e.observe('Runtime.executionContextDestroyed',destroyed));
 e.observe('Runtime.executionContextDestroyed',Object.create({executionContextId:96}));
 assert.equal(getters,0,'destroyed-context metadata accessors must not be invoked');
 assert.deepEqual(e.snapshot(),{defaultContextObserved:false,isolatedContextObserved:true},
  'forged destruction must not remove a live context');
 e.observe('Runtime.executionContextDestroyed',{executionContextId:96});
 assert.deepEqual(e.snapshot(),{defaultContextObserved:false,isolatedContextObserved:false});
});
