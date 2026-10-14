import assert from 'node:assert/strict';
import {test} from 'node:test';

const fixtureUrl='http://127.0.0.1:43219/fixture';
const target={type:'page',id:'fixture-owned',url:fixtureUrl,
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fixture-owned'};
const frame={targetId:target.id,confirmedUrl:fixtureUrl,frameId:'fixture-frame',loaderId:'loader-initial'};
const snapshot=(count:number)=>({
 caseId:'SYNTHETIC:V2:NAMED',expectation:'exists',status:'passed',reason:'two snapshots',
 matchCount:count,initialMatchCount:null,attempts:2,evidenceLevel:'V1',
 V2:'blocked',V3:'not-configured',V4:'not-configured',
 functionalVerified:false,managerVerified:false,
});
async function lifecycle(){
 const candidate=await import('../../scripts/fixture-v2-named-lifecycle.ts').catch(()=>({} as Record<string,unknown>));
 assert.equal(typeof (candidate as any).runNamedFixtureV2Lifecycle,'function',
  'Missing isolated named V2 fixture effect + cleanup lifecycle');
 return (candidate as any).runNamedFixtureV2Lifecycle as (input:any)=>Promise<any>;
}
function harness({postCount=2,postError=false,actionError=false,resetError=false,resetCount=1,navigateEarly=false}={}){
 const events:string[]=[];
 let observed=0;
 let reset=false;
 const deps={
  confirm:async()=>{events.push('confirm');return reset?{...frame,loaderId:'loader-after-reset'}:
   navigateEarly&&observed>0?{...frame,loaderId:'unexpected-navigation'}:frame;},
  observe:async()=>{events.push('observe');const stage=observed++;if(stage===1&&postError)throw Error('synthetic post-observation failure');
   return snapshot(stage===0?1:stage===1?postCount:resetCount);},
  interact:async()=>{events.push('interact');if(actionError)throw Error('synthetic click rejected');
   return {validationLevel:'synthetic-fixture-interaction',observed:true,productionEligible:false};},
  reset:async()=>{events.push('reset');if(resetError)throw Error('synthetic reload failed');reset=true;},
 };
 return {events,deps};
}
test('RG-03 approved localhost fixture lifecycle proves one named effect and verified cleanup, not product V2/V3',async()=>{
 const run=await lifecycle(),{events,deps}=harness();
 const result=await run({approved:true,target,fixtureUrl,deps});
 assert.equal(result.status,'fixture-passed');
 assert.equal(result.validationLevel,'synthetic-v2-lifecycle');
 assert.equal(result.namedCase,'fixed-synthetic-click-count-transition');
 assert.equal(result.beforeCount,1);
 assert.equal(result.afterCount,2);
 assert.equal(result.cleanedCount,1);
 assert.equal(result.cleanupVerified,true);
 assert.equal(result.productionEligible,false);
 assert.equal(result.V2,'blocked');
 assert.equal(result.V3,'not-configured');
 assert.equal(result.V4,'not-configured');
 assert.equal(result.managerVerified,false);
 assert.equal(result.functionalVerified,false);
 assert.deepEqual(events.filter(e=>e==='interact'),['interact']);
 assert.deepEqual(events.filter(e=>e==='reset'),['reset']);
 assert.ok(events.indexOf('interact')>events.indexOf('observe'));
 assert.ok(events.lastIndexOf('observe')>events.indexOf('reset'));
});
test('RG-03 missing effect or stale page rejects positive outcome but still cleans up the test-only fixture',async()=>{
 const run=await lifecycle();
 for(const config of [{postCount:1},{postCount:3},{postError:true},{navigateEarly:true}]){
  const {events,deps}=harness(config);
  await assert.rejects(run({approved:true,target,fixtureUrl,deps}),/effect|count|observation|document|identity|fixture|inconclusive/i);
  assert.equal(events.filter(e=>e==='reset').length,1,'failure must still reset fixture');
  assert.equal(events.at(-1),'observe','cleanup must have a fresh read-only verification');
 }
});
test('RG-03 simulated action fault is cleanup-safe and cannot be promoted to a synthetic pass',async()=>{
 const run=await lifecycle(),{events,deps}=harness({actionError:true});
 await assert.rejects(run({approved:true,target,fixtureUrl,deps}),/click|fixture|action|interact/i);
 assert.equal(events.filter(e=>e==='reset').length,1);
 assert.equal(events.filter(e=>e==='interact').length,1);
 assert.equal(events.at(-1),'observe');
});
test('RG-03 failed cleanup or missing baseline rejects instead of emitting a success receipt',async()=>{
 const run=await lifecycle();
 for(const config of [{resetError:true},{resetCount:2}]){
  const {events,deps}=harness(config);
  await assert.rejects(run({approved:true,target,fixtureUrl,deps}),/cleanup|reset|fixture|baseline/i);
  assert.equal(events.filter(e=>e==='reset').length,1);
 }
});
test('RG-03 invalid URL, approval and CDP identity reject before touching fixture or browser',async()=>{
 const run=await lifecycle();
 const invalid=[
  {approved:false,target,fixtureUrl},
  {approved:true,target:{...target,url:'https://account.example/pay'},fixtureUrl:'https://account.example/pay'},
  {approved:true,target:{...target,url:'http://localhost:43219/fixture'},fixtureUrl:'http://localhost:43219/fixture'},
  {approved:true,target,fixtureUrl:fixtureUrl+'?send=yes'},
  {approved:true,target:{...target,webSocketDebuggerUrl:'ws://elsewhere.test:9223/devtools/page/fixture-owned'},fixtureUrl},
 ];
 for(const input of invalid){
  const {events,deps}=harness();
  await assert.rejects(run({...input,deps}),/approval|fixture|target|CDP|local|identity|URL/i);
  assert.deepEqual(events,[],'never call confirm, observe or interact before failing preflight');
 }
});
test('RG-03 fixture-only V2 lifecycle cannot be imported by Electron production surfaces',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const p of ['apps/desktop/src/main/index.ts','apps/desktop/src/preload/index.ts','apps/desktop/src/renderer/App.tsx']){
  const source=await readFile(p,'utf8');
  assert.doesNotMatch(source,/fixture-v2-named-lifecycle|runNamedFixtureV2Lifecycle|local-fixture-interaction/,
   'test-only Input is forbidden in user production UI and Main');
 }
});
