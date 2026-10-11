import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runSyntheticFunctionalLifecycle,SYNTHETIC_LIFECYCLE_SOURCES}
 from '../../scripts/synthetic-functional-lifecycle.ts';

const fixtureUrl='http://127.0.0.1:45867/fixture';
const target={
 id:'local-synthetic-tab',type:'page',url:fixtureUrl,
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/local-synthetic-tab',
} as const;
const expectedSources=[
 SYNTHETIC_LIFECYCLE_SOURCES.baseline,SYNTHETIC_LIFECYCLE_SOURCES.partial,
 SYNTHETIC_LIFECYCLE_SOURCES.repaired,SYNTHETIC_LIFECYCLE_SOURCES.rollback,
];
const input=(execute:(source:string)=>Promise<boolean>)=>({
 approved:true,target,fixtureUrl,sources:{...SYNTHETIC_LIFECYCLE_SOURCES},execute,
});

test('named functional cycle requires baseline FAIL, partial FAIL, repaired PASS, restored FAIL',async()=>{
 const observed:string[]=[];
 const statuses=[false,false,true,false];
 const receipt=await runSyntheticFunctionalLifecycle(input(async source=>{
  observed.push(source);return statuses[observed.length-1]!;
 }));
 assert.deepEqual(observed,expectedSources);
 assert.equal(receipt.caseId,'SYNTHETIC-TWO-SELECTOR-REPAIR-ROLLBACK');
 assert.equal(receipt.status,'fixture-passed');
 assert.deepEqual(receipt.observations,{baseline:false,partial:false,repaired:true,rollback:false});
 assert.equal(receipt.validationLevel,'synthetic-fixture-functional');
 assert.equal(receipt.productionEligible,false);
 assert.equal(receipt.V3,'not-configured');
 assert.equal(receipt.V4,'not-configured');
 assert.equal(receipt.functionalVerified,false);
 assert.equal(receipt.managerVerified,false);
});

test('any false-positive success or failed repair/rollback cannot pass the fixture contract',async()=>{
 for(const [stage,states] of [
  ['baseline',[true,false,true,false]],
  ['partial',[false,true,true,false]],
  ['repaired',[false,false,false,false]],
  ['rollback',[false,false,true,true]],
 ] as const){
  let i=0;
  const result=await runSyntheticFunctionalLifecycle(input(async()=>states[i++]!));
  assert.equal(result.status,'fixture-failed',stage);
  assert.equal(result.failedStage,stage);
  assert.equal(result.productionEligible,false);
  assert.equal(result.V3,'not-configured');
  assert.equal(result.managerVerified,false);
 }
});

test('untrusted JS masquerading as fixture cannot be evaluated, even with trusted metadata',async()=>{
 let invoked=0;
 for(const source of [
  SYNTHETIC_LIFECYCLE_SOURCES.repaired+'fetch("https://example.invalid/leak")',
  SYNTHETIC_LIFECYCLE_SOURCES.repaired.replace('.target-pane','.account-secret'),
  SYNTHETIC_LIFECYCLE_SOURCES.repaired.replace('// @match http://127.0.0.1/*','// @match https://example.com/*'),
 ]){
  await assert.rejects(runSyntheticFunctionalLifecycle({
   ...input(async()=>{invoked++;return false;}),
   sources:{...SYNTHETIC_LIFECYCLE_SOURCES,repaired:source},
  }),/synthetic|allowlist|fixture|source|refus/i);
 }
 assert.equal(invoked,0);
});

test('no production target or missing explicit approval can use synthetic functional evaluation',async()=>{
 let executed=0;
 const run=async()=>{executed++;return false;};
 const cases=[
  {...input(run),approved:false},
  {...input(run),target:{...target,type:'other'}},
  {...input(run),target:{...target,url:'https://example.com'}},
  {...input(run),fixtureUrl:'http://localhost:45867/fixture'},
  {...input(run),fixtureUrl:fixtureUrl+'?token=private'},
  {...input(run),target:{...target,webSocketDebuggerUrl:'ws://example.com/devtools/page/local-synthetic-tab'}},
 ];
 for(const candidate of cases)
  await assert.rejects(runSyntheticFunctionalLifecycle(candidate as any),/approval|fixture|target|localhost|CDP|loopback|identity/i);
 assert.equal(executed,0);
});

test('runner failures fail closed without leaking raw script/browser errors or certifying V3',async()=>{
 const output=await runSyntheticFunctionalLifecycle(input(async()=>{throw new Error('secret-key/private-path');}));
 assert.equal(output.status,'fixture-blocked');
 assert.equal(output.failedStage,'baseline');
 assert.equal(output.reason,'Synthetic fixture execution unavailable');
 assert.equal(JSON.stringify(output).includes('secret-key'),false);
 assert.equal(output.V3,'not-configured');
 assert.equal(output.managerVerified,false);
});

test('only the test runner imports synthetic functional execution, never Electron production entrypoints',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const path of [
  '../../apps/desktop/src/main/index.ts',
  '../../apps/desktop/src/preload/index.ts',
  '../../apps/desktop/src/renderer/App.tsx',
  '../../scripts/build.mjs',
 ]){
  const content=await readFile(new URL(path,import.meta.url),'utf8');
  assert.doesNotMatch(content,/synthetic-functional-lifecycle|runSyntheticFunctionalLifecycle/);
 }
});
