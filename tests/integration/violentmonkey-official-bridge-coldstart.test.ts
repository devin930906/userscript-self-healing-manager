import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const fixture='http://127.0.0.1:58643/fixture';
const method='buildViolentmonkeyContentBridgeDiagnosticExpression';
async function evaluate(bridgeReply:unknown,options:{missing?:boolean;reject?:boolean;fake?:boolean}={}){
 const exported=(contract as Record<string,unknown>)[method];
 assert.equal(typeof exported,'function','RG-05 official content bridge diagnostic missing');
 const expression=(exported as (url:string)=>string)(fixture);
 assert.ok(expression.length<3300,'diagnostic JS budget exceeded');
 assert.doesNotMatch(expression,/Runtime\.evaluate|document\.cookie|localStorage|eval\(|Function\(/);
 const calls:string[]=[];
 const value=await vm.runInNewContext(expression,{
  chrome:{tabs:{
   async query(query:unknown){
    calls.push('query');
    assert.deepEqual(JSON.parse(JSON.stringify(query)),{url:'http://127.0.0.1/*'});
    return options.missing?[]:[{id:25,url:fixture},...(options.fake?[{id:26,url:fixture}]:[])];
   },
   async sendMessage(tabId:number,message:unknown,details:unknown){
    calls.push('message');
    assert.equal(tabId,25);
    assert.deepEqual(JSON.parse(JSON.stringify(message)),{cmd:'Violentmonkey'});
    assert.deepEqual(JSON.parse(JSON.stringify(details)),{frameId:0});
    if(options.reject)throw Error('USER_PRIVATE_CONTEXT_NEVER_EXPORTED');
    return bridgeReply;
   },
  }},
  JSON,Object,Array,Promise,setTimeout,clearTimeout,
 });
 assert.equal(typeof value,'string');
 assert.ok(value.length<=120,'only bounded bridge booleans may cross CDP');
 assert.doesNotMatch(value,/USER_PRIVATE_CONTEXT_NEVER_EXPORTED|58643|devtools|script|source|code/i);
 return {result:JSON.parse(value),calls};
}
test('RG-05 official pinned content bridge yields two booleans without any userscript inventory, source or private errors',async()=>{
 assert.deepEqual(await evaluate(true),{result:{targetFound:true,bridgeResponded:true},calls:['query','message']});
 assert.deepEqual(await evaluate(false),{result:{targetFound:true,bridgeResponded:false},calls:['query','message']});
 assert.deepEqual(await evaluate('PRIVATE_USER_SOURCE'),{result:{targetFound:true,bridgeResponded:false},calls:['query','message']});
});
test('RG-05 official bridge is fail-closed for absent/ambiguous tabs and transport errors',async()=>{
 assert.deepEqual(await evaluate(undefined,{missing:true}),{result:{targetFound:false,bridgeResponded:false},calls:['query']});
 assert.deepEqual(await evaluate(undefined,{fake:true}),{result:{targetFound:false,bridgeResponded:false},calls:['query']});
 assert.deepEqual(await evaluate(undefined,{reject:true}),{result:{targetFound:true,bridgeResponded:false},calls:['query','message']});
 const exported=(contract as Record<string,unknown>)[method] as (url:string)=>string;
 for(const url of ['https://example.invalid/fixture','http://127.0.0.1/fixture',
   'http://127.0.0.1:58643/fixture?token=secret','http://localhost:58643/fixture',
   'http://127.0.0.1:58643/anything'])assert.throws(()=>exported(url),/fixture|URL|scope/i);
});
test('RG-05 bridge check occurs only AFTER both genuine post-restart GM fixture documents produced no receipt',async()=>{
 const smoke=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 assert.match(smoke,/buildViolentmonkeyContentBridgeDiagnosticExpression/);
 const success=smoke.indexOf('const secondReceipt=assertViolentmonkeyV4FixtureObservation');
 const close=smoke.indexOf("browserCdp.send('Browser.close')");
 const observation=smoke.indexOf('startupInjectionBlocked=true');
 const first=smoke.indexOf('readOfficialContentBridgeDiagnostic(optionsCdp,fixtureUrl');
 const second=smoke.indexOf('readOfficialContentBridgeDiagnostic(optionsCdp,fixtureUrl',first+10);
 const gate=smoke.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(success>=0&&first>success&&first<close,
  'baseline diagnostic must require TWO already-observed genuine GM receipts, before Chrome restart');
 assert.ok(observation>close&&second>observation&&gate>second,
  'post-restart diagnostic must be measured only after two missing GM documents');
 assert.equal(smoke.indexOf('readOfficialContentBridgeDiagnostic(optionsCdp,fixtureUrl',second+10),-1,
  'only one control and one already-blocked observation may query the bridge');
 assert.match(smoke,/BLOCKED RG-05 official VM 2\.49\.0 Chrome process restart/);
});
