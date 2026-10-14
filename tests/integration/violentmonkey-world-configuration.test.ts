import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const expectedCsp="script-src 'self' 'unsafe-inline' 'unsafe-eval';style-src * 'unsafe-inline' data: blob:";

async function readFixedWorld(configurations:unknown,fail=false){
 const builder=(contract as Record<string,unknown>).buildViolentmonkeyWorldConfigurationExpression;
 assert.equal(typeof builder,'function','RG-05 official Chrome world configuration check missing');
 const expression=(builder as ()=>string)();
 assert.ok(expression.length<1600,'world diagnostic expression must be bounded');
 const called:string[]=[];
 const value=await vm.runInNewContext(expression,{
  chrome:{userScripts:{async getWorldConfigurations(){
   called.push('world-configurations');
   if(fail)throw Error('PRIVATE_LOCAL_PROFILE_SENTINEL');
   return configurations;
  }}},
  JSON,Array,Object,
 });
 assert.deepEqual(called,['world-configurations']);
 assert.equal(typeof value,'string');
 assert.ok(value.length<160);
 assert.doesNotMatch(value,/script-src|PRIVATE_LOCAL_PROFILE_SENTINEL|blob:/);
 return JSON.parse(value);
}

test('RG-05 reads only booleans from official USER_SCRIPT world configuration, including messaging and CSP',async()=>{
 const good=[{worldId:'',messaging:true,csp:expectedCsp}];
 assert.deepEqual(await readFixedWorld(good),{
  defaultWorldConfigured:true,messagingEnabled:true,expectedCsp:true,
 });
 assert.deepEqual(await readFixedWorld([{worldId:'named',messaging:true,csp:expectedCsp}]),{
  defaultWorldConfigured:false,messagingEnabled:false,expectedCsp:false,
 });
 assert.deepEqual(await readFixedWorld([{worldId:'',messaging:false,csp:expectedCsp}]),{
  defaultWorldConfigured:true,messagingEnabled:false,expectedCsp:true,
 });
 assert.deepEqual(await readFixedWorld([{worldId:'',messaging:true,csp:"script-src 'self'"}]),{
  defaultWorldConfigured:true,messagingEnabled:true,expectedCsp:false,
 });
});

test('RG-05 world configuration probe fails closed without exporting browser configuration',async()=>{
 const empty={defaultWorldConfigured:false,messagingEnabled:false,expectedCsp:false};
 assert.deepEqual(await readFixedWorld([]),empty);
 assert.deepEqual(await readFixedWorld(undefined),empty);
 assert.deepEqual(await readFixedWorld(null,true),empty);
 assert.deepEqual(await readFixedWorld([{worldId:'',messaging:true,csp:expectedCsp},{worldId:'',messaging:true,csp:expectedCsp}]),empty);
});
