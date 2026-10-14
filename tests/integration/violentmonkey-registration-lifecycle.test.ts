import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const fixtureUrl='http://127.0.0.1:49152/fixture';

async function probeRegistration(input:{
 base?:{id:string;matches:string[]};
 data?:{id:string;matches:string[]};
 secret?:string;
}){
 const builder=(contract as Record<string,unknown>).buildViolentmonkeyFixtureRegistrationExpression;
 assert.equal(typeof builder,'function','missing official Chrome userScripts registration evidence');
 const expression=(builder as (url:string)=>string)(fixtureUrl);
 const calls:unknown[]=[];
 const base=input.base?{...input.base,js:[{get code(){throw new Error('PRIVATE_SCRIPT_SOURCE');}}]}:undefined;
 const data=input.data?{...input.data,js:[{get code(){throw new Error('PRIVATE_SCRIPT_SOURCE');}}]}:undefined;
 const raw=await vm.runInNewContext(expression,{
  JSON,URL,Array,chrome:{userScripts:{async getScripts(query:unknown){
   calls.push(JSON.parse(JSON.stringify(query)));
   const ids=(query as {ids:string[]}).ids;
   if(JSON.stringify(ids)===JSON.stringify(['1001']))return base?[base]:[];
   if(JSON.stringify(ids)===JSON.stringify(['1000'+fixtureUrl]))return data?[data]:[];
   throw new Error('Unexpected userScripts inventory request');
  }}},
 });
 assert.deepEqual(calls,[{ids:['1001']},{ids:['1000'+fixtureUrl]}]);
 assert.equal(typeof raw,'string');
 assert.ok(raw.length<160,'registration diagnostic must remain bounded');
 assert.doesNotMatch(raw,/PRIVATE_SCRIPT_SOURCE|PRIVATE_SCRIPT_ID|@grant|userscript/);
 return JSON.parse(raw);
}

test('RG-05 identifies official base and ephemeral URL registration without reading code',async()=>{
 const base={id:'1001',matches:['<all_urls>']};
 const data={id:'1000'+fixtureUrl,matches:[fixtureUrl]};
 assert.deepEqual(await probeRegistration({base,data}),{
  baseRegistered:true,fixtureDataRegistered:true,
  baseMatchesFixture:true,dataMatchesFixture:true,
 });
 assert.deepEqual(await probeRegistration({base}),{
  baseRegistered:true,fixtureDataRegistered:false,
  baseMatchesFixture:true,dataMatchesFixture:false,
 });
 assert.deepEqual(await probeRegistration({base:{...base,id:'other'},data:{...data,matches:['http://elsewhere.invalid/*']}}),{
  baseRegistered:false,fixtureDataRegistered:true,
  baseMatchesFixture:false,dataMatchesFixture:false,
 });
});

test('RG-05 registration diagnostic refuses non-isolated URL and never promotes a V4 pass',async()=>{
 const builder=(contract as Record<string,unknown>).buildViolentmonkeyFixtureRegistrationExpression as
  (url:string)=>string;
 assert.equal(typeof builder,'function');
 for(const url of ['https://account.example/fixture','http://127.0.0.1/fixture',
  'http://127.0.0.1:49152/other','http://127.0.0.1:49152/fixture?secret=1']){
  assert.throws(()=>builder(url),/isolated|fixture|scope|URL/i);
 }
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const snapshots=[...source.matchAll(/readManagerFixtureRegistration\(optionsCdp,fixtureUrl,\(\)=>exited\)/g)]
  .map(m=>m.index);
 assert.ok(snapshots.length>=3,'compare before first page, after real restart and after missing GM receipt');
 assert.ok(snapshots[0]!<source.indexOf('const createdFixture=await browserCdp.send'));
 assert.ok(snapshots[1]!<source.indexOf('const createdRestartFixture=await browserCdp.send'));
 assert.match(source,/assertOfficialViolentmonkeyReleaseGate\(blocked\.status\)/);
 assert.doesNotMatch(source,/console\.log\([^\n]*\.js|console\.log\([^\n]*userScript/);
});
