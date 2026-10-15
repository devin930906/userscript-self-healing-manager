import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import * as contract from '../../scripts/violentmonkey-v4-contract.ts';

const api=contract as any;
test('fixture capability probe checks the real userScripts API without returning registered code',async()=>{
 assert.equal(typeof api.buildViolentmonkeyUserScriptsProbeExpression,'function');
 const expression=api.buildViolentmonkeyUserScriptsProbeExpression();
 for(const available of [true,false]){
  const context=vm.createContext({chrome:{userScripts:{async getScripts(){
   if(!available)throw Error('private browser permission error');
   return [{id:'private script',js:[{code:'private source'}]}];
  }}},JSON});
  assert.equal(await vm.runInContext(expression,context),JSON.stringify({available}));
 }
 assert.equal(await vm.runInNewContext(expression,{chrome:{},JSON}),JSON.stringify({available:false}));
});

test('isolated permission setup changes only the pinned unpacked manager and verifies readback',async()=>{
 assert.equal(typeof api.buildViolentmonkeyUserScriptsAccessExpression,'function');
 const expression=api.buildViolentmonkeyUserScriptsAccessExpression();
 const updates:any[]=[];
 let active=false;
 const id=contract.VIOLENTMONKEY_CFT_RELEASE.extensionId;
 const info=()=>({id,version:'2.49.0',state:'ENABLED',location:'UNPACKED',
  userScriptsAccess:{isEnabled:true,isActive:active},name:'private name',path:'private path'});
 const context=vm.createContext({location:{href:'chrome://extensions/'},JSON,chrome:{developerPrivate:{
  async getExtensionInfo(requested:string){assert.equal(requested,id);return info();},
  async updateExtensionConfiguration(update:any){updates.push(JSON.parse(JSON.stringify(update)));active=true;},
 }}});
 assert.equal(await vm.runInContext(expression,context),JSON.stringify({available:true}));
 assert.deepEqual(updates,[{extensionId:id,userScriptsAccess:true}]);
 assert.equal(await vm.runInContext(expression,context),JSON.stringify({available:true}));
 assert.equal(updates.length,1,'an already enabled permission does not need another mutation');
});

test('permission setup rejects the wrong page, extension identity, version, installation and denied readback',async()=>{
 assert.equal(typeof api.buildViolentmonkeyUserScriptsAccessExpression,'function');
 const expression=api.buildViolentmonkeyUserScriptsAccessExpression();
 const valid={id:contract.VIOLENTMONKEY_CFT_RELEASE.extensionId,version:'2.49.0',
  state:'ENABLED',location:'UNPACKED',userScriptsAccess:{isEnabled:true,isActive:false}};
 for(const [patch,reason] of [[{id:'other'},'identity'],[{version:'2.48.0'},'version'],[{state:'DISABLED'},'state'],
  [{location:'FROM_STORE'},'installation'],[{userScriptsAccess:{isEnabled:false,isActive:false}},'toggle-unavailable']] as const){
  let writes=0;
  const result=await vm.runInNewContext(expression,{location:{href:'chrome://extensions/'},JSON,
   chrome:{developerPrivate:{async getExtensionInfo(){return {...valid,...patch};},
    async updateExtensionConfiguration(){writes++;}}}});
  assert.equal(result,JSON.stringify({available:false,reason}));assert.equal(writes,0);
 }
 let reads=0;
 const wrongPage=await vm.runInNewContext(expression,{location:{href:'https://private.example/'},JSON,
  chrome:{developerPrivate:{async getExtensionInfo(){reads++;return valid;}}}});
 assert.equal(wrongPage,JSON.stringify({available:false,reason:'page-context'}));assert.equal(reads,0);
 const denied=await vm.runInNewContext(expression,{location:{href:'chrome://extensions/'},JSON,
  chrome:{developerPrivate:{async getExtensionInfo(){return valid;},async updateExtensionConfiguration(){}}}});
 assert.equal(denied,JSON.stringify({available:false,reason:'readback'}));
});

test('permission setup distinguishes an unready Chrome settings API without leaking browser error details',async()=>{
 const expression=api.buildViolentmonkeyUserScriptsAccessExpression();
 const missing=await vm.runInNewContext(expression,{location:{href:'chrome://extensions/'},chrome:{},JSON});
 assert.equal(missing,JSON.stringify({available:false,reason:'settings-api'}));
 const rejected=await vm.runInNewContext(expression,{location:{href:'chrome://extensions/'},JSON,
  chrome:{developerPrivate:{async getExtensionInfo(){throw Error('private browser sentinel');},
   async updateExtensionConfiguration(){throw Error('must not run');}}}});
 assert.equal(rejected,JSON.stringify({available:false,reason:'settings-error'}));
 assert.doesNotMatch(rejected,/private browser sentinel/);
});

test('Chrome settings setup waits for its actual WebUI context before changing the pinned permission',async()=>{
 assert.equal(typeof api.enableViolentmonkeyUserScriptsAccess,'function');
 const responses=['page-context','settings-api',null];
 let calls=0,waits=0;
 await api.enableViolentmonkeyUserScriptsAccess(async(method:string,params:any)=>{
  assert.equal(method,'Runtime.evaluate');
  assert.equal(params.expression,api.buildViolentmonkeyUserScriptsAccessExpression());
  const reason=responses[calls++];
  return {result:{value:JSON.stringify(reason?{available:false,reason}:{available:true})}};
 },async()=>{waits++;});
 assert.equal(calls,3);assert.equal(waits,2);
});

test('settings context retries are bounded and identity or permission failures never get retried',async()=>{
 assert.equal(typeof api.enableViolentmonkeyUserScriptsAccess,'function');
 for(const reason of ['identity','version','state','installation','toggle-unavailable','readback','settings-error']){
  let calls=0;
  await assert.rejects(()=>api.enableViolentmonkeyUserScriptsAccess(async()=>{
   calls++;return {result:{value:JSON.stringify({available:false,reason})}};
  },async()=>{}),new RegExp(reason));
  assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(()=>api.enableViolentmonkeyUserScriptsAccess(async()=>{
  calls++;return {result:{value:JSON.stringify({available:false,reason:'page-context'})}};
 },async()=>{}),/page-context/);
 assert.equal(calls,20);
 const error=await api.enableViolentmonkeyUserScriptsAccess(async()=>({result:{value:
  JSON.stringify({available:false,reason:'private browser sentinel'})}}),async()=>{}).catch((e:any)=>e);
 assert.match(error.message,/invalid-receipt/);assert.doesNotMatch(error.message,/private browser sentinel/);
});


test('read-only userScripts access status distinguishes enabled from active without mutating Chrome settings',async()=>{
 assert.equal(typeof api.buildViolentmonkeyUserScriptsAccessStatusExpression,'function');
 const expression=api.buildViolentmonkeyUserScriptsAccessStatusExpression();
 const id=contract.VIOLENTMONKEY_CFT_RELEASE.extensionId;
 let writes=0;
 const run=async(active:boolean,enabled=true)=>vm.runInNewContext(expression,{
  location:{href:'chrome://extensions/'},JSON,
  chrome:{developerPrivate:{
   async getExtensionInfo(requested:string){
    assert.equal(requested,id);
    return {id,version:'2.49.0',state:'ENABLED',location:'UNPACKED',
     userScriptsAccess:{isEnabled:enabled,isActive:active},
     name:'PRIVATE_NAME',path:'PRIVATE_PATH'};
   },
   async updateExtensionConfiguration(){writes++;throw Error('must remain read-only');},
  }},
 });
 assert.equal(await run(true),JSON.stringify({matched:true,enabled:true,active:true}));
 assert.equal(await run(false),JSON.stringify({matched:true,enabled:true,active:false}));
 assert.equal(await run(false,false),JSON.stringify({matched:true,enabled:false,active:false}));
 assert.equal(writes,0);
});

test('read-only userScripts access status fails closed for wrong context or pinned identity without leaking metadata',async()=>{
 const expression=api.buildViolentmonkeyUserScriptsAccessStatusExpression();
 const id=contract.VIOLENTMONKEY_CFT_RELEASE.extensionId;
 const empty=JSON.stringify({matched:false,enabled:false,active:false});
 assert.equal(await vm.runInNewContext(expression,{location:{href:'https://private.example/'},chrome:{},JSON}),empty);
 for(const patch of [
  {id:'other'},{version:'2.48.0'},{state:'DISABLED'},{location:'FROM_STORE'},
 ]){
  const value=await vm.runInNewContext(expression,{location:{href:'chrome://extensions/'},JSON,
   chrome:{developerPrivate:{async getExtensionInfo(){
    return {id,version:'2.49.0',state:'ENABLED',location:'UNPACKED',
     userScriptsAccess:{isEnabled:true,isActive:true},name:'PRIVATE_NAME',path:'PRIVATE_PATH',...patch};
   }}}});
  assert.equal(value,empty);
  assert.doesNotMatch(value,/PRIVATE|path|name|other|2\.48/);
 }
});


test('read-only userScripts capability status distinguishes missing API from rejected query without leaking details',async()=>{
 assert.equal(typeof api.buildViolentmonkeyUserScriptsCapabilityStatusExpression,'function');
 const expression=api.buildViolentmonkeyUserScriptsCapabilityStatusExpression();
 const missing=await vm.runInNewContext(expression,{chrome:{},JSON});
 assert.equal(missing,JSON.stringify({apiPresent:false,querySucceeded:false}));
 const rejected=await vm.runInNewContext(expression,{JSON,chrome:{userScripts:{
  async getScripts(){throw Error('PRIVATE_SENTINEL');},
 }}});
 assert.equal(rejected,JSON.stringify({apiPresent:true,querySucceeded:false}));
 assert.doesNotMatch(rejected,/PRIVATE_SENTINEL/);
 const success=await vm.runInNewContext(expression,{JSON,chrome:{userScripts:{
  async getScripts(){return [{id:'PRIVATE_ID',js:[{code:'PRIVATE_SOURCE'}]}];},
 }}});
 assert.equal(success,JSON.stringify({apiPresent:true,querySucceeded:true}));
 assert.doesNotMatch(success,/PRIVATE_ID|PRIVATE_SOURCE/);
});


test('read-only userScripts access reason is allowlisted and never exposes extension metadata',async()=>{
 assert.equal(typeof api.buildViolentmonkeyUserScriptsAccessReasonExpression,'function');
 const expression=api.buildViolentmonkeyUserScriptsAccessReasonExpression();
 const id=contract.VIOLENTMONKEY_CFT_RELEASE.extensionId;
 const valid={id,version:'2.49.0',state:'ENABLED',location:'UNPACKED',
  userScriptsAccess:{isEnabled:true,isActive:true},name:'PRIVATE_NAME',path:'PRIVATE_PATH'};
 const run=async(patch:any={})=>{
  let writes=0;
  const value=await vm.runInNewContext(expression,{location:{href:'chrome://extensions/'},JSON,
   chrome:{developerPrivate:{
    async getExtensionInfo(){return {...valid,...patch};},
    async updateExtensionConfiguration(){writes++;throw Error('must remain read-only');},
   }}});
  assert.equal(writes,0);
  assert.doesNotMatch(value,/PRIVATE_NAME|PRIVATE_PATH/);
  return value;
 };
 assert.equal(await run(),JSON.stringify({reason:'active'}));
 assert.equal(await run({userScriptsAccess:{isEnabled:true,isActive:false}}),
  JSON.stringify({reason:'toggle-inactive'}));
 assert.equal(await run({userScriptsAccess:{isEnabled:false,isActive:false}}),
  JSON.stringify({reason:'toggle-disabled'}));
 assert.equal(await run({state:'DISABLED'}),JSON.stringify({reason:'state'}));
 assert.equal(await run({location:'FROM_STORE'}),JSON.stringify({reason:'installation'}));
 const wrongPage=await vm.runInNewContext(expression,{location:{href:'https://private.example/'},chrome:{},JSON});
 assert.equal(wrongPage,JSON.stringify({reason:'page-context'}));
 const missingApi=await vm.runInNewContext(expression,{location:{href:'chrome://extensions/'},chrome:{},JSON});
 assert.equal(missingApi,JSON.stringify({reason:'settings-api'}));
 const rejected=await vm.runInNewContext(expression,{location:{href:'chrome://extensions/'},JSON,
  chrome:{developerPrivate:{async getExtensionInfo(){throw Error('PRIVATE_SENTINEL');}}}});
 assert.equal(rejected,JSON.stringify({reason:'settings-error'}));
 assert.doesNotMatch(rejected,/PRIVATE_SENTINEL/);
});
