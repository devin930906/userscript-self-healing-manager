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
