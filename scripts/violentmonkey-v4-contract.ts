import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';

export const VIOLENTMONKEY_CFT_RELEASE=Object.freeze({
 version:'2.49.0',
 extensionId:'jinjaccalgkegednnccohejagnlnfdag',
 archiveSha256:'3fa676c803a9698453ed23dfe496d4bc29a4bec52f6a95e55c43c2955921f8ee',
 publicKey:'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvNNjtIVXIerv8ArGiIk2xHgO2/vmDXgMNPl5ok6zGTkndXXXzz1z5FyqThG41KTw+7Ax4UGid0Q0DVo3aHD/CLJTLBzWlDwpgM3vskBBtOSxYZhWDPFv5vgj+8UQ5sbArgJYdVtlVnv8wFkUfwqbSQZzsBY/VH6fXik0JaWBY09zAe4CvrTtr5ilq9HxVQM6bGTYnQ2aYtwAJIMWdvS1XR0za4mvyxwPn/IjLer54O1Z2atarGTmINVcoyzmO6C/EeMmblc+yb6AaInwKbNIKKjv+pZfxnUKfXfmKtfxhsOpvULLeo4Z45z+HU4I8RimO8MeiGbmrrLrnOPmRcz+0QIDAQAB',
});

export function extensionIdFromChromePublicKey(publicKeyBase64:string):string{
 if(typeof publicKeyBase64!=='string'||publicKeyBase64.length<128||publicKeyBase64.length>2048||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKeyBase64))
  throw new Error('Invalid Chrome extension public key');
 const key=Buffer.from(publicKeyBase64,'base64');
 if(key.length<96||key.length>1536||key.toString('base64')!==publicKeyBase64)
  throw new Error('Invalid Chrome extension public key encoding');
 return [...createHash('sha256').update(key).digest().subarray(0,16)]
  .map(value=>String.fromCharCode(97+(value>>4),97+(value&15))).join('');
}

/** TEST ONLY: check permission without returning the manager's registered code. */
export function buildViolentmonkeyUserScriptsProbeExpression():string{
 return `(async()=>{
  try{
   if(typeof chrome.userScripts?.getScripts!=='function')return JSON.stringify({available:false});
   await chrome.userScripts.getScripts();
   return JSON.stringify({available:true});
  }catch{return JSON.stringify({available:false});}
 })()`;
}


/**
 * RG-05 TEST ONLY: distinguish a missing userScripts API from a present API
 * whose read is rejected. Return only two booleans; never serialize browser
 * errors, registered script metadata, code, IDs, or other extension state.
 */
export function buildViolentmonkeyUserScriptsCapabilityStatusExpression():string{
 return `(async()=>{
  const fixed=(apiPresent,querySucceeded)=>JSON.stringify({apiPresent,querySucceeded});
  try{
   if(typeof chrome.userScripts?.getScripts!=='function')return fixed(false,false);
   try{
    await chrome.userScripts.getScripts();
    return fixed(true,true);
   }catch{return fixed(true,false);}
  }catch{return fixed(false,false);}
 })()`;
}

/** Pin the fixed test script to the exact port bound by this fixture server. */
export function scopeViolentmonkeyFixtureToUrl(template:string,fixtureUrl:string):string{
 let url:URL;
 try{url=new URL(fixtureUrl);}catch{throw new Error('Invalid isolated fixture scope');}
 const anchor='// @match http://127.0.0.1/*';
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/fixture'||
    url.username||url.password||url.search||url.hash||url.href!==fixtureUrl||
    typeof template!=='string'||template.length>8192||template.split(anchor).length!==2||
    !template.includes('// @name USSHM Isolated Violentmonkey V4 Fixture')||
    !template.includes('// @namespace https://usshm.invalid/isolated-fixture'))
  throw new Error('Invalid isolated fixture scope');
 return template.replace(anchor,'// @match '+fixtureUrl);
}

/**
 * RG-05 TEST ONLY: observe the *official Chrome userScripts* registrations
 * without ever reading/serializing JS code or private manager inventory.
 * Violentmonkey 2.49.0 uses base ID 1001 and transient URL data ID 1000+URL
 * (src/common/browser-scripts-api.js and preinject-core.js at v2.49.0).
 * Read-only diagnostics are not injection execution evidence or a V4 pass.
 */
export function buildViolentmonkeyFixtureRegistrationExpression(fixtureUrl:string):string{
 let url:URL;
 try{url=new URL(fixtureUrl);}catch{throw new Error('Invalid isolated fixture URL');}
 if(typeof fixtureUrl!=='string'||fixtureUrl.length>160||url.href!==fixtureUrl||
    url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
    url.pathname!=='/fixture'||url.username||url.password||url.search||url.hash)
  throw new Error('Invalid isolated fixture URL');
 const fixedUrl=JSON.stringify(fixtureUrl);
 return `(async()=>{
  const empty=()=>JSON.stringify({baseRegistered:false,fixtureDataRegistered:false,
   baseMatchesFixture:false,dataMatchesFixture:false});
  try{
   if(typeof chrome.userScripts?.getScripts!=='function')return empty();
   const baseList=await chrome.userScripts.getScripts({ids:['1001']});
   const dataList=await chrome.userScripts.getScripts({ids:['1000'+${fixedUrl}]});
   const base=Array.isArray(baseList)&&baseList.length===1?baseList[0]:null;
   const data=Array.isArray(dataList)&&dataList.length===1?dataList[0]:null;
   const baseRegistered=base?.id==='1001';
   const fixtureDataRegistered=data?.id==='1000'+${fixedUrl};
   const baseMatchesFixture=baseRegistered&&Array.isArray(base.matches)&&
    (base.matches.includes('<all_urls>')||base.matches.includes(${fixedUrl}));
   const dataMatchesFixture=fixtureDataRegistered&&Array.isArray(data.matches)&&
    data.matches.includes(${fixedUrl});
   return JSON.stringify({baseRegistered:!!baseRegistered,
    fixtureDataRegistered:!!fixtureDataRegistered,
    baseMatchesFixture:!!baseMatchesFixture,dataMatchesFixture:!!dataMatchesFixture});
  }catch{return empty();}
 })()`;
}

/**
 * RG-05 DIAGNOSTIC ONLY, isolated CFT profile: distinguish a Chrome registered
 * injector from its official content bridge actually answering in the exact
 * loopback main frame. Upstream Violentmonkey v2.49.0 content/bridge.js responds
 * to its internal cmd "Violentmonkey" with true; no GetInjected, arbitrary
 * userscript code, tabs inventory, extension errors or runtime content leaves
 * the manager. Never use as product V4 or official GM execution evidence.
 */
export function buildViolentmonkeyContentBridgeDiagnosticExpression(fixtureUrl:string):string{
 let url:URL;
 try{url=new URL(fixtureUrl);}catch{throw new Error('Invalid isolated fixture URL');}
 if(typeof fixtureUrl!=='string'||fixtureUrl.length>160||url.href!==fixtureUrl||
    url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
    url.pathname!=='/fixture'||url.username||url.password||url.search||url.hash)
  throw new Error('Invalid isolated fixture URL');
 const pinned=JSON.stringify(fixtureUrl);
 return `(async()=>{
  const fixed=(targetFound,bridgeResponded)=>JSON.stringify({
   targetFound:!!targetFound,bridgeResponded:!!bridgeResponded});
  try{
   if(typeof chrome.tabs?.query!=='function'||
      typeof chrome.tabs?.sendMessage!=='function')return fixed(false,false);
   const candidates=await chrome.tabs.query({url:'http://127.0.0.1/*'});
   if(!Array.isArray(candidates))return fixed(false,false);
   const exact=candidates.filter(item=>item&&item.url===${pinned}&&
    Number.isSafeInteger(item.id)&&item.id>=0);
   if(exact.length!==1)return fixed(false,false);
   let timer;
   try{
    const answer=await Promise.race([
     chrome.tabs.sendMessage(exact[0].id,{cmd:'Violentmonkey'},{frameId:0}),
     new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1500);}),
    ]);
    return fixed(true,answer===true);
   }catch{return fixed(true,false);}
   finally{clearTimeout(timer);}
  }catch{return fixed(false,false);}
 })()`;
}

/**
 * RG-05 TEST ONLY: inspect Chrome's actual USER_SCRIPT world settings before
 * and after the isolated browser-process restart. Chrome 133+ exposes the
 * official getWorldConfigurations API; never export the original CSP, script
 * source, private world IDs or extension inventory to the CDP caller.
 * A world-state observation alone is never manager V4 evidence.
 */
export function buildViolentmonkeyWorldConfigurationExpression():string{
 const expectedCsp=JSON.stringify("script-src 'self' 'unsafe-inline' 'unsafe-eval';style-src * 'unsafe-inline' data: blob:");
 return `(async()=>{
  const empty=()=>JSON.stringify({defaultWorldConfigured:false,messagingEnabled:false,expectedCsp:false});
  try{
   if(typeof chrome.userScripts?.getWorldConfigurations!=='function')return empty();
   const worlds=await chrome.userScripts.getWorldConfigurations();
   if(!Array.isArray(worlds))return empty();
   const defaults=worlds.filter(item=>item&&typeof item==='object'&&
    (item.worldId===''||item.worldId===undefined));
   if(defaults.length!==1)return empty();
   const world=defaults[0];
   return JSON.stringify({defaultWorldConfigured:true,
    messagingEnabled:world.messaging===true,expectedCsp:world.csp===${expectedCsp}});
  }catch{return empty();}
 })()`;
}

/**
 * RG-05 TEST ONLY: read the pinned unpacked manager's Chrome 138+ Allow User
 * Scripts setting without changing it. The CDP caller receives only three
 * booleans; extension metadata and arbitrary developerPrivate fields stay in
 * the chrome://extensions execution context.
 */
export function buildViolentmonkeyUserScriptsAccessStatusExpression():string{
 const id=JSON.stringify(VIOLENTMONKEY_CFT_RELEASE.extensionId);
 const version=JSON.stringify(VIOLENTMONKEY_CFT_RELEASE.version);
 return `(async()=>{
  const empty=()=>JSON.stringify({matched:false,enabled:false,active:false});
  try{
   if(location.href!=='chrome://extensions/')return empty();
   const api=chrome.developerPrivate;
   if(typeof api?.getExtensionInfo!=='function')return empty();
   const info=await api.getExtensionInfo(${id});
   const matched=info?.id===${id}&&info.version===${version}&&
    info.state==='ENABLED'&&info.location==='UNPACKED';
   if(!matched)return empty();
   const enabled=info.userScriptsAccess?.isEnabled===true;
   const active=enabled&&info.userScriptsAccess?.isActive===true;
   return JSON.stringify({matched:true,enabled:!!enabled,active:!!active});
  }catch{return empty();}
 })()`;
}


/**
 * RG-05 TEST ONLY: classify the pinned manager's Chrome 138+ Allow User
 * Scripts state without changing it. Only a fixed allowlisted reason leaves
 * chrome://extensions; extension metadata and browser error strings do not.
 */
export function buildViolentmonkeyUserScriptsAccessReasonExpression():string{
 const id=JSON.stringify(VIOLENTMONKEY_CFT_RELEASE.extensionId);
 const version=JSON.stringify(VIOLENTMONKEY_CFT_RELEASE.version);
 return `(async()=>{
  const fixed=reason=>JSON.stringify({reason});
  try{
   if(location.href!=='chrome://extensions/')return fixed('page-context');
   const api=chrome.developerPrivate;
   if(typeof api?.getExtensionInfo!=='function')return fixed('settings-api');
   const info=await api.getExtensionInfo(${id});
   if(info?.id!==${id})return fixed('identity');
   if(info.version!==${version})return fixed('version');
   if(info.state!=='ENABLED'){
    if(info.state==='DISABLED'){
     // Inspect fixed public booleans only; never export extension metadata.
     // Multiple true reasons must not be misreported as only 'reloading'.
     const mappings=[
      ['reloading','state-disabled-reloading'],
      ['unsupportedDeveloperExtension','state-disabled-unsupported-developer'],
      ['unsupportedManifestVersion','state-disabled-unsupported-manifest'],
      ['corruptInstall','state-disabled-corrupt'],
      ['suspiciousInstall','state-disabled-suspicious'],
      ['updateRequired','state-disabled-update'],
      ['publishedInStoreRequired','state-disabled-store'],
      ['blockedByPolicy','state-disabled-policy'],
      ['custodianApprovalRequired','state-disabled-custodian'],
      ['parentDisabledPermissions','state-disabled-parent'],
      ['disabledByAnotherExtension','state-disabled-other-extension'],
     ];
     const disabled=info.disableReasons;
     const matches=mappings.filter(([flag])=>{
      const field=disabled&&typeof disabled==='object'?
       Object.getOwnPropertyDescriptor(disabled,flag):null;
      return !!field&&Object.hasOwn(field,'value')&&field.value===true;
     });
     return fixed(matches.length===0?'state-disabled-none':
      matches.length>1?'state-disabled-multiple':matches[0][1]);
    }
    if(info.state==='TERMINATED')return fixed('state-terminated');
    if(info.state==='BLOCKLISTED')return fixed('state-blocklisted');
    return fixed('state-other');
   }
   if(info.location!=='UNPACKED')return fixed('installation');
   if(info.userScriptsAccess?.isEnabled!==true)return fixed('toggle-disabled');
   if(info.userScriptsAccess?.isActive!==true)return fixed('toggle-inactive');
   return fixed('active');
  }catch{return fixed('settings-error');}
 })()`;
}

/**
 * RG-05 TEST ONLY: take two passive, bounded Chrome settings receipts before
 * any post-blocker extension reload. A missing or inconsistent receipt must
 * remain "unavailable", never interpreted as a disabled or active manager.
 * Only fixed state codes leave chrome://extensions; no extension metadata.
 */
export async function readViolentmonkeyPreReloadAccess(
 send:(method:string,params:Record<string,unknown>)=>Promise<unknown>,
):Promise<Readonly<{
 observed:boolean;matched:boolean;enabled:boolean;active:boolean;reason:string
}>>{
 const unavailable=()=>Object.freeze({
  observed:false,matched:false,enabled:false,active:false,reason:'unavailable',
 });
 if(typeof send!=='function')return unavailable();
 const allowed=new Set([
  'active','toggle-inactive','toggle-disabled','page-context','settings-api',
  'settings-error','identity','version','installation',
  'state-disabled-reloading','state-disabled-unsupported-developer',
  'state-disabled-unsupported-manifest','state-disabled-corrupt',
  'state-disabled-suspicious','state-disabled-update','state-disabled-store',
  'state-disabled-policy','state-disabled-custodian','state-disabled-parent',
  'state-disabled-other-extension','state-disabled-none',
  'state-disabled-multiple','state-terminated','state-blocklisted','state-other',
 ]);
 const evaluate=async(expression:string):Promise<unknown>=>{
  const response=await send('Runtime.evaluate',{
   expression,awaitPromise:true,returnByValue:true,
  });
  if(!response||typeof response!=='object'||Array.isArray(response)||
     'error' in response||'exceptionDetails' in response)
   throw new Error('Invalid passive manager access envelope');
  const result=Object.getOwnPropertyDescriptor(response,'result')?.value;
  if(!result||typeof result!=='object'||Array.isArray(result)||
     'error' in result||'exceptionDetails' in result)
   throw new Error('Invalid passive manager access result');
  const receipt=Object.getOwnPropertyDescriptor(result,'value')?.value;
  if(typeof receipt!=='string'||receipt.length<2||receipt.length>160)
   throw new Error('Invalid passive manager access receipt');
  return JSON.parse(receipt);
 };
 try{
  const status=await evaluate(buildViolentmonkeyUserScriptsAccessStatusExpression());
  const reasonReceipt=await evaluate(buildViolentmonkeyUserScriptsAccessReasonExpression());
  if(!status||typeof status!=='object'||Array.isArray(status)||
     Object.keys(status).sort().join(',')!=='active,enabled,matched'||
     !Object.values(status).every(v=>typeof v==='boolean')||
     !reasonReceipt||typeof reasonReceipt!=='object'||Array.isArray(reasonReceipt)||
     Object.keys(reasonReceipt).join(',')!=='reason')
   return unavailable();
  const {matched,enabled,active}=status as {matched:boolean;enabled:boolean;active:boolean};
  const {reason}=reasonReceipt as {reason:unknown};
  if(typeof reason!=='string'||!allowed.has(reason)||(!matched&&(enabled||active))||
     (active&&!enabled)||
     (reason==='active'&&!(matched&&enabled&&active))||
     (reason==='toggle-inactive'&&!(matched&&enabled&&!active))||
     (reason==='toggle-disabled'&&!(matched&&!enabled&&!active))||
     (!['active','toggle-inactive','toggle-disabled'].includes(reason)&&matched))
   return unavailable();
  return Object.freeze({observed:true,matched,enabled,active,reason});
 }catch{
  // Never surface raw private CDP errors or extension metadata.
  return unavailable();
 }
}

/**
 * RG-05 TEST ONLY: read the disposable Chrome profile Developer Mode switch.
 * Never enable the switch, enumerate profiles, or include private metadata.
 * Used after an already failed GM cold start to avoid a diagnostic reload
 * disabling an unpacked extension in a Developer-Mode-OFF profile.
 */
export function buildViolentmonkeyProfileDeveloperModeExpression():string{
 return `(async()=>{
  try{
   if(location.href!=='chrome://extensions/')return 'unavailable';
   const api=chrome.developerPrivate;
   if(typeof api?.getProfileConfiguration!=='function')return 'unavailable';
   const info=await api.getProfileConfiguration();
   const flag=info&&typeof info==='object'?
    Object.getOwnPropertyDescriptor(info,'inDeveloperMode'):null;
   if(!flag||!Object.hasOwn(flag,'value')||typeof flag.value!=='boolean')
    return 'unavailable';
   return flag.value?'enabled':'disabled';
  }catch{return 'unavailable';}
 })()`;
}

/**
 * RG-05 controlled compatibility experiment ONLY. Enable Chrome Extensions
 * Developer Mode solely in the fresh, disposable CFT155 test profile, with an
 * exact chrome://extensions WebUI origin and fresh readback. This never alters
 * the daily Chrome profile, production manager, GM fixture or release gate.
 * Requiring real GM receipts after a full process restart remains mandatory.
 */
export function buildDisposableProfileDeveloperModeExpression():string{
 return `(async()=>{
  try{
   if(location.href!=='chrome://extensions/')return 'unavailable';
   const api=chrome.developerPrivate;
   if(typeof api?.getProfileConfiguration!=='function'||
      typeof api?.updateProfileConfiguration!=='function')return 'unavailable';
   const before=await api.getProfileConfiguration();
   const previous=before&&typeof before==='object'?
    Object.getOwnPropertyDescriptor(before,'inDeveloperMode'):null;
   const policy=before&&typeof before==='object'?
    Object.getOwnPropertyDescriptor(before,'isDeveloperModeControlledByPolicy'):null;
   if(!previous||!Object.hasOwn(previous,'value')||
      typeof previous.value!=='boolean'||policy?.value===true)return 'unavailable';
   if(previous.value!==true)
    await api.updateProfileConfiguration({inDeveloperMode:true});
   const after=await api.getProfileConfiguration();
   const state=after&&typeof after==='object'?
    Object.getOwnPropertyDescriptor(after,'inDeveloperMode'):null;
   const afterPolicy=after&&typeof after==='object'?
    Object.getOwnPropertyDescriptor(after,'isDeveloperModeControlledByPolicy'):null;
   return state&&Object.hasOwn(state,'value')&&state.value===true&&
    afterPolicy?.value!==true?'enabled':'unavailable';
  }catch{return 'unavailable';}
 })()`;
}

export async function enableDisposableProfileDeveloperMode(
 send:(method:string,params:Record<string,unknown>)=>Promise<unknown>,
):Promise<void>{
 if(typeof send!=='function')
  throw new Error('RG-05 disposable profile Developer Mode gate unavailable');
 let value:string;
 try{
  const response=await send('Runtime.evaluate',{
   expression:buildDisposableProfileDeveloperModeExpression(),
   awaitPromise:true,returnByValue:true,
  });
  value=readViolentmonkeyManagerDiagnosticCdpValue(response,80);
 }catch{
  throw new Error('RG-05 disposable profile Developer Mode gate unavailable');
 }
 if(value!=='enabled')
  throw new Error('RG-05 disposable profile Developer Mode readback not enabled');
}

/**
 * TEST ONLY: equivalent to the Chrome 138+ Allow User Scripts toggle, scoped
 * to the pinned unpacked manager in the workflow's disposable profile.
 * Never set global Developer Mode, file access, or access for another manager.
 */
export function buildViolentmonkeyUserScriptsAccessExpression():string{
 const id=JSON.stringify(VIOLENTMONKEY_CFT_RELEASE.extensionId);
 const version=JSON.stringify(VIOLENTMONKEY_CFT_RELEASE.version);
 return `(async()=>{
  const finish=(available,reason)=>JSON.stringify(available?{available:true}:{available:false,reason});
  try{
   if(location.href!=='chrome://extensions/')return finish(false,'page-context');
   const api=chrome.developerPrivate;
   if(typeof api?.getExtensionInfo!=='function'||typeof api?.updateExtensionConfiguration!=='function')
    return finish(false,'settings-api');
   const invalid=info=>info?.id!==${id}?'identity':info.version!==${version}?'version':
    info.state!=='ENABLED'?'state':info.location!=='UNPACKED'?'installation':
    info.userScriptsAccess?.isEnabled!==true?'toggle-unavailable':null;
   const before=await api.getExtensionInfo(${id});
   const reason=invalid(before);
   if(reason)return finish(false,reason);
   if(before.userScriptsAccess.isActive!==true)
    await api.updateExtensionConfiguration({extensionId:${id},userScriptsAccess:true});
   const after=await api.getExtensionInfo(${id});
   return finish(!invalid(after)&&after.userScriptsAccess.isActive===true,'readback');
  }catch{return finish(false,'settings-error');}
 })()`;
}

/** URL discovery can precede the WebUI execution context. Retry only readiness. */
export async function enableViolentmonkeyUserScriptsAccess(
 send:(method:string,params:Record<string,unknown>)=>Promise<any>,
 delay:(milliseconds:number)=>Promise<unknown>=wait,
):Promise<void>{
 const reasons=['page-context','settings-api','identity','version','state','installation',
  'toggle-unavailable','readback','settings-error'];
 let reason='invalid-receipt';
 for(let attempt=0;attempt<20;attempt++){
  let answer;
  try{
   answer=await send('Runtime.evaluate',{
    expression:buildViolentmonkeyUserScriptsAccessExpression(),awaitPromise:true,returnByValue:true,
   });
  }catch{throw new Error('Pinned unpacked manager Allow User Scripts CDP evaluation failed');}
  let receipt;
  const text=answer?.result?.value;
  if(!answer?.exceptionDetails&&typeof text==='string'&&text.length<=256){
   try{receipt=JSON.parse(text);}catch{}
  }
  if(receipt?.available===true&&Object.keys(receipt).length===1)return;
  reason=receipt?.available===false&&Object.keys(receipt).length===2&&reasons.includes(receipt.reason)
   ?receipt.reason:'invalid-receipt';
  if(reason!=='page-context'&&reason!=='settings-api')break;
  if(attempt<19)await delay(150);
 }
 throw new Error('Pinned unpacked manager Allow User Scripts permission could not be enabled: '+reason);
}

export function assertViolentmonkeyRestartPermissionReceipt(response:unknown):true{
 const fail=():never=>{
  throw new Error('Pinned manager userScripts permission not retained across process restart');
 };
 const data=(candidate:unknown,key:string):unknown=>{
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||
     'error' in candidate||'exceptionDetails' in candidate)fail();
  const field=Object.getOwnPropertyDescriptor(candidate,key);
  if(!field||!Object.hasOwn(field,'value'))fail();
  return field.value;
 };
 let value:unknown;
 try{value=data(data(response,'result'),'value');}
 catch{fail();}
 if(value!==JSON.stringify({available:true}))fail();
 return true;
}

export function assertViolentmonkeyPreflightReceipt(response:unknown):{found:boolean}{
 const fail=():never=>{
  throw new Error('Violentmonkey read-only preflight returned an invalid fixed receipt');
 };
 const ownData=(object:unknown,key:string):unknown=>{
  if(!object||typeof object!=='object'||Array.isArray(object)||
     'error' in object||'exceptionDetails' in object)fail();
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))fail();
  return descriptor.value;
 };
 let value:unknown;
 try{value=ownData(ownData(response,'result'),'value');}
 catch{fail();}
 if(typeof value!=='string'||value.length>512)fail();
 let parsed:unknown;
 try{parsed=JSON.parse(value);}catch{fail();}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
    Object.keys(parsed).length!==1||!Object.hasOwn(parsed,'found')||
    typeof (parsed as {found?:unknown}).found!=='boolean')fail();
 return {found:(parsed as {found:boolean}).found};
}

export function readViolentmonkeyManagerDiagnosticCdpValue(
 response:unknown,maxBytes:number,
):string{
 const fail=():never=>{throw new Error('Isolated manager diagnostic CDP envelope invalid');};
 if(maxBytes!==80&&maxBytes!==160&&maxBytes!==256)fail();
 const ownData=(object:unknown,key:string):unknown=>{
  if(!object||typeof object!=='object'||Array.isArray(object)||
     'error' in object||'exceptionDetails' in object)fail();
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))fail();
  return descriptor.value;
 };
 let value:unknown;
 try{value=ownData(ownData(response,'result'),'value');}
 catch{fail();}
 if(typeof value!=='string'||value.length>maxBytes)fail();
 return value;
}

/** TEST ONLY: read a bounded receipt from one fixed loopback fixture document. */
export async function readViolentmonkeyFixtureObservation(input:{
 send:(method:string,params?:Record<string,unknown>)=>Promise<any>;
 frameId:string;url:string;previousLoaderId?:string;
 hasExited:()=>boolean;delay?:(milliseconds:number)=>Promise<unknown>;
}):Promise<ViolentmonkeyFixtureObservation['fixture']>{
 let url:URL;
 try{url=new URL(input.url);}catch{throw new Error('Invalid isolated fixture identity');}
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/fixture'||
    url.username||url.password||url.search||url.hash||url.href!==input.url||
    typeof input.frameId!=='string'||!input.frameId||input.frameId.length>128||
    input.previousLoaderId!==undefined&&(typeof input.previousLoaderId!=='string'||
      !input.previousLoaderId||input.previousLoaderId.length>128))
  throw new Error('Invalid isolated fixture identity');
 const currentFrame=async()=>{
  let answer;
  try{answer=await input.send('Page.getFrameTree');}
  catch{throw new Error('Isolated fixture frame inspection failed');}
  const frame=answer?.frameTree?.frame;
  if(frame?.id!==input.frameId||frame.url!==input.url||typeof frame.loaderId!=='string'||
     !frame.loaderId||frame.loaderId.length>128)
   throw new Error('Isolated fixture document identity changed');
  return frame.loaderId as string;
 };
 let observedFreshDocument=false;
 for(let attempt=0;attempt<72;attempt++){
  if(input.hasExited())throw new Error('Isolated CFT exited during GM fixture observation');
  const before=await currentFrame();
  if(before!==input.previousLoaderId){
   observedFreshDocument=true;
   let answer;
   try{
    answer=await input.send('Runtime.evaluate',{
     expression:"document.documentElement?.getAttribute('data-usshm-vm-v4-result') ?? null",
     returnByValue:true,
    });
   }catch{throw new Error('Isolated GM fixture evaluation failed');}
   if(answer?.exceptionDetails)throw new Error('Isolated GM fixture evaluation failed');
   const after=await currentFrame();
   if(after!==before)throw new Error('Isolated fixture document identity changed');
   // A valid-looking CDP reply is not evidence from a live manager if CFT
   // exited during the evaluation or its final pinned-document check.
   if(input.hasExited())throw new Error('Isolated CFT exited during GM fixture observation');
   const value=answer?.result?.value;
   if(value!==undefined&&value!==null){
    if(typeof value!=='string'||value.length>1024)throw new Error('Invalid bounded GM fixture receipt');
    let receipt;
    try{receipt=JSON.parse(value);}catch{throw new Error('Invalid bounded GM fixture receipt');}
    if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))
     throw new Error('Invalid bounded GM fixture receipt');
    return receipt;
   }
  }
  await (input.delay??wait)(250);
 }
 const stages=['started','storage-read','storage-readback','menu-registration','gm-request','completed',
  'failed-started','failed-storage-read','failed-storage-readback','failed-menu-registration','failed-gm-request'];
 // Never read a stage attribute from the old document if the requested
 // reload never completed. The fallback is diagnostic only, not GM evidence.
 if(!observedFreshDocument)
  throw new Error('Pinned Violentmonkey fixture did not publish its bounded GM API result; stage: not-observed');
 if(input.hasExited())throw new Error('Isolated CFT exited during GM fixture observation');
 const stageLoader=await currentFrame();
 let stage='not-observed';
 try{
  const answer=await input.send('Runtime.evaluate',{
   expression:"document.documentElement?.getAttribute('data-usshm-vm-v4-stage') ?? null",returnByValue:true,
  });
  // Diagnostic-only fallback: never invoke an accessor or trust inherited
  // fields, CDP fault envelopes or non-string stage values. Inconclusive
  // responses stay "not-observed"; they can never certify GM execution.
  const ownData=(candidate:unknown,key:string):unknown=>{
   if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||
      'error' in candidate||'exceptionDetails' in candidate)return undefined;
   const field=Object.getOwnPropertyDescriptor(candidate,key);
   return field&&Object.hasOwn(field,'value')?field.value:undefined;
  };
  const observed=ownData(ownData(answer,'result'),'value');
  if(typeof observed==='string'&&stages.includes(observed))stage=observed;
 }catch{}
 // A late navigation or CFT exit must not allow a stage read from a
 // different document to be reported as the approved loopback fixture.
 if(input.hasExited())throw new Error('Isolated CFT exited during GM fixture observation');
 if(await currentFrame()!==stageLoader)
  throw new Error('Isolated fixture document identity changed');
 throw new Error('Pinned Violentmonkey fixture did not publish its bounded GM API result; stage: '+stage);
}

/**
 * Build a fixed-shape query using Violentmonkey's official MV3 client/SW
 * channel. The manager's extension page reduces its own script inventory to
 * one boolean before the CDP caller receives any response.
 */
function buildViolentmonkeyManagerCommandExpression(
 command:'GetData'|'ParseScript'|'GetInjectorError'|'GetAllOptions'|'GetMoreIds',data:Record<string,unknown>,requestId:number,responseCode:string,
):string{
 const serializedData=JSON.stringify(data);
 if(!Number.isSafeInteger(requestId)||!serializedData||serializedData.length>16_384)
  throw new Error('Invalid fixed Violentmonkey manager command');
 return `new Promise(resolve=>{
  const endpoint=navigator.serviceWorker;
  if(!endpoint||typeof endpoint.addEventListener!=='function')return resolve(null);
  let timer,finished=false;
  const finish=value=>{
   if(finished)return;
   finished=true;clearTimeout(timer);
   endpoint.removeEventListener('message',onMessage);
   resolve(value);
  };
  const onMessage=event=>{
   const packet=event.data;
   if(packet?.id!==${requestId})return;
   if(Object.hasOwn(packet,'err')&&packet.err!==undefined)return finish(JSON.stringify({failed:true}));
   const value=packet.res;
   ${responseCode}
  };
  endpoint.addEventListener('message',onMessage);
  timer=setTimeout(()=>finish(null),3500);
  Promise.resolve(endpoint.ready).then(registration=>{
   const worker=endpoint.controller||registration.active;
   if(!worker)return finish(null);
   worker.postMessage({id:${requestId},msg:{cmd:${JSON.stringify(command)},data:${serializedData}}});
  }).catch(()=>finish(null));
 })`;
}

/** Fixed bounded readiness stages: never emit a manager error or script code. */
export type ViolentmonkeyInjectorReadinessState=
 'worker-receipt-unavailable'|'official-injector-error'|'base-injector-unregistered'|'cdp-evaluation-failed'|'cdp-timeout'|'cdp-websocket-closed'|'ready';

/**
 * TEST ONLY: an isolated Chrome permission grant alone is not evidence of a
 * ready official manager. Two independently exact receipts must be observed.
 * Never retry indefinitely or leak private CDP/extension diagnostic details.
 * This cannot upgrade the application's production V4 status.
 */
export async function waitForVerifiedViolentmonkeyInjector(input:{
 send:(method:string,params:Record<string,unknown>)=>Promise<any>;
 hasExited:()=>boolean;
 delay?:(milliseconds:number)=>Promise<unknown>;
 onStatus?:(stage:ViolentmonkeyInjectorReadinessState)=>void;
}):Promise<void>{
 if(!input||typeof input!=='object'||Array.isArray(input)||
    typeof input.send!=='function'||typeof input.hasExited!=='function'||
    (input.delay!==undefined&&typeof input.delay!=='function')||
    (input.onStatus!==undefined&&typeof input.onStatus!=='function'))
  throw new Error('Invalid isolated manager injector readiness request');
 const readyReceipt=JSON.stringify({ready:true});
 const errorReceipt=JSON.stringify({ready:false});
 const evaluate=async(expression:string):Promise<unknown>=>{
  let response;
  try{
   response=await input.send('Runtime.evaluate',{
    expression,awaitPromise:true,returnByValue:true,
   });
  }catch(error){
   // Only classify exact, fixed strings emitted by the isolated CDP client.
   // Never echo arbitrary exception contents into logs or caller-visible errors.
   const message=error instanceof Error?error.message:'';
   const stage:ViolentmonkeyInjectorReadinessState=message==='CDP command timed out'
    ?'cdp-timeout':message==='CDP WebSocket closed'
    ?'cdp-websocket-closed':'cdp-evaluation-failed';
   notify(stage);
   throw new Error('Isolated manager injector CDP evaluation failed');
  }
  try{
   if(response&&typeof response==='object'&&('error' in response||'exceptionDetails' in response))
    throw new Error('Isolated manager injector CDP evaluation failed');
   // CDP JSON response members must be own data; reject prototype-inherited fixtures.
   if(!response||typeof response!=='object'||Array.isArray(response))
    throw new Error('Isolated manager injector CDP evaluation failed');
   const resultField=Object.getOwnPropertyDescriptor(response,'result');
   if(!resultField||!Object.hasOwn(resultField,'value')||!Object.hasOwn(response,'result'))
    throw new Error('Isolated manager injector CDP evaluation failed');
   const result=resultField.value;
   // Runtime.evaluate exceptionDetails lives inside the CDP command's result
   // envelope, not just at the top level of the transport response.
   if(result&&typeof result==='object'&&
      ('exceptionDetails' in result||'error' in result))
    throw new Error('Isolated manager injector CDP evaluation failed');
   if(!result||typeof result!=='object'||Array.isArray(result))
    throw new Error('Isolated manager injector CDP evaluation failed');
   const valueField=Object.getOwnPropertyDescriptor(result,'value');
   if(!valueField||!Object.hasOwn(valueField,'value')||!Object.hasOwn(result,'value'))
    throw new Error('Isolated manager injector CDP evaluation failed');
   // Allow a missing worker receipt (null/undefined) to remain transient.
   // Reject non-string present values rather than retrying malformed CDP data.
   if(valueField.value!==null&&valueField.value!==undefined&&
      typeof valueField.value!=='string')
    throw new Error('Isolated manager injector CDP evaluation failed');
   return valueField.value;
  }catch{
   // A hostile or malformed CDP envelope must not leak access errors or pass readiness.
   notify('cdp-evaluation-failed');
   throw new Error('Isolated manager injector CDP evaluation failed');
  }
 };
 const notify=(stage:ViolentmonkeyInjectorReadinessState)=>{
  try{input.onStatus?.(stage);}catch{}
 };
 let stage:ViolentmonkeyInjectorReadinessState='worker-receipt-unavailable';
 for(let attempt=0;attempt<16;attempt++){
  if(input.hasExited())throw new Error('Isolated CFT exited during manager injector readiness');
  const official=await evaluate(buildViolentmonkeyInjectorReadyExpression());
  if(input.hasExited())throw new Error('Isolated CFT exited during manager injector readiness');
  if(official===readyReceipt){
   const base=await evaluate(buildViolentmonkeyInjectorProbeExpression());
   if(input.hasExited())throw new Error('Isolated CFT exited during manager injector readiness');
   if(base===readyReceipt){notify('ready');return;}
   stage='base-injector-unregistered';
  }else{
   stage=official===errorReceipt?'official-injector-error':'worker-receipt-unavailable';
  }
  notify(stage);
  if(attempt<15)await (input.delay??wait)(350);
 }
 throw new Error(stage==='base-injector-unregistered'
  ?'Pinned Violentmonkey base injector files were not registered'
  :'Pinned Violentmonkey official injector readiness was not verified');
}

/** TEST ONLY: initialize the official injector after Chrome grants permission. */
export function buildViolentmonkeyInjectorReadyExpression():string{
 return buildViolentmonkeyManagerCommandExpression('GetInjectorError',{},0x7ffffffc,`
   finish(JSON.stringify({ready:Object.hasOwn(packet,'res')&&(value===undefined||value===null)}));`);
}

/** Return only a boolean for the exact pinned manager's base injector files. */
export function buildViolentmonkeyInjectorProbeExpression():string{
 return `(async()=>{
  try{
   const scripts=await chrome.userScripts.getScripts({ids:['1001']});
   const entry=Array.isArray(scripts)&&scripts.length===1?Object.getOwnPropertyDescriptor(scripts,'0'):null;
   const script=entry&&Object.hasOwn(entry,'value')?entry.value:null;
   const ready=script&&['id','runAt','allFrames','js','matches'].every(key=>
    Object.hasOwn(script,key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(script,key),'value'))&&
    script.id==='1001'&&script.runAt==='document_start'&&script.allFrames===true&&
    Array.isArray(script.js)&&script.js.length===2&&[0,1].every(index=>{
     const element=Object.getOwnPropertyDescriptor(script.js,String(index));
     if(!element||!Object.hasOwn(element,'value'))return false;
     const item=element.value;
     if(!item||typeof item!=='object'||'code' in item)return false;
     const file=Object.getOwnPropertyDescriptor(item,'file');
     return !!file&&Object.hasOwn(file,'value')&&
      file.value===(index===0?'injected-web.js':'injected.js');
    })&&
    Array.isArray(script.matches)&&script.matches.length===1&&
    (()=>{const scope=Object.getOwnPropertyDescriptor(script.matches,'0');
     return !!scope&&Object.hasOwn(scope,'value')&&scope.value==='<all_urls>';})()&&
    ['excludeMatches','excludeGlobs','includeGlobs'].every(key=>{
     if(!Object.hasOwn(script,key))return !(key in script);
     const field=Object.getOwnPropertyDescriptor(script,key);
     return !!field&&Object.hasOwn(field,'value')&&
      (field.value===undefined||(Array.isArray(field.value)&&field.value.length===0));
    });
   return JSON.stringify({ready:!!ready});
  }catch{return JSON.stringify({ready:false});}
 })()`;
}

/**
 * TEST ONLY: read three official manager injection option flags after MV3
 * service-worker initialization. Return a bounded boolean DTO, never
 * serialize the full options object or script inventory over CDP.
 */
export function buildViolentmonkeyManagerInjectionOptionsExpression():string{
 return buildViolentmonkeyManagerCommandExpression('GetAllOptions',{},0x7ffffffa,`
  const applied=value?.isApplied===true;
  const fastInject=value?.ffInject===true;
  const xhrInject=value?.xhrInject===true;
  finish(JSON.stringify({applied,fastInject,xhrInject}));`);
}

/**
 * Build a fixed-shape query using Violentmonkey's official MV3 client/SW
 * channel. Its script inventory is reduced to one boolean inside the page.
 */
export function buildViolentmonkeyFixturePreflightExpression(name:string,namespace:string):string{
 if(typeof name!=='string'||name.length<1||name.length>160||
    typeof namespace!=='string'||namespace.length<1||namespace.length>256)
  throw new Error('Invalid fixed Violentmonkey fixture identity');
 const serializedName=JSON.stringify(name);
 const serializedNamespace=JSON.stringify(namespace);
 return buildViolentmonkeyManagerCommandExpression('GetData',{sizes:false},0x7ffffffe,`
   const scripts=value?.scripts;
   if(!Array.isArray(scripts))return finish(JSON.stringify({failed:true}));
   const found=scripts.some(script=>script?.meta?.name===${serializedName}&&
    script?.meta?.namespace===${serializedNamespace});
   finish(JSON.stringify({found}));`);
}

/**
 * RG-05 TEST ONLY. Ask the pinned official manager to match its OWN installed
 * fixed fixture against one exact loopback URL. GetMoreIds with ids:{} takes
 * the non-executing membership path in VM 2.49.0 and returns only ID flags.
 * Reduce those flags to a single boolean in the manager page itself.
 */
export function buildViolentmonkeyFixtureMatchExpression(fixtureUrl:string,scriptId:number):string{
 let url:URL;
 try{url=new URL(fixtureUrl);}catch{throw new Error('Invalid isolated fixture scope');}
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
    url.pathname!=='/fixture'||url.username||url.password||url.search||url.hash||
    url.href!==fixtureUrl||!Number.isSafeInteger(scriptId)||scriptId<1)
  throw new Error('Invalid fixed fixture scope or script identity');
 const key=JSON.stringify(String(scriptId));
 return buildViolentmonkeyManagerCommandExpression('GetMoreIds',{
  url:fixtureUrl,top:1,ids:{},
 },0x7ffffff9,`
  const valid=value&&typeof value==='object'&&!Array.isArray(value);
  const keys=valid?Object.keys(value):[];
  const matched=keys.length===1&&keys[0]===${key}&&value[${key}]==='more';
  finish(JSON.stringify({matched:!!matched}));`);
}

/**
 * Reduce official GetData to four fixed booleans inside the pinned extension.
 * This is test-only, read-only, post-restart evidence: no code, URL or raw
 * manager inventory is returned to the CDP client.
 */
export function buildViolentmonkeyFixtureRuntimeConfigurationExpression(
 name:string,namespace:string,fixtureUrl:string,
):string{
 let url:URL;
 try{url=new URL(fixtureUrl);}catch{throw new Error('Invalid isolated fixture scope');}
 if(typeof name!=='string'||name.length<1||name.length>160||
    typeof namespace!=='string'||namespace.length<1||namespace.length>256||
    url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
    url.pathname!=='/fixture'||url.username||url.password||url.search||url.hash||
    url.href!==fixtureUrl)
  throw new Error('Invalid isolated fixture scope');
 const grants=['GM_getValue','GM_setValue','GM_registerMenuCommand','GM_xmlhttpRequest'];
 return buildViolentmonkeyManagerCommandExpression('GetData',{sizes:false},0x7ffffffb,`
  const scripts=value?.scripts;
  if(!Array.isArray(scripts))return finish(JSON.stringify({failed:true}));
  const found=scripts.filter(script=>script?.meta?.name===${JSON.stringify(name)}&&
   script?.meta?.namespace===${JSON.stringify(namespace)});
  if(found.length!==1)
   return finish(JSON.stringify({present:false,enabled:false,scope:false,gmGrants:false}));
  const script=found[0];
  const enabled=script?.config?.enabled===1;
  const scope=Array.isArray(script?.meta?.match)&&script.meta.match.includes(${JSON.stringify(fixtureUrl)});
  const gmGrants=Array.isArray(script?.meta?.grant)&&
   ${JSON.stringify(grants)}.every(grant=>script.meta.grant.includes(grant));
  finish(JSON.stringify({present:true,enabled,scope,gmGrants}));`);
}

/** Build an install request that returns only a bounded parser/install receipt. */
export function buildViolentmonkeyFixtureInstallExpression(code:string):string{
 if(typeof code!=='string'||code.length<1||code.length>8_192||
    !code.includes('// @name USSHM Isolated Violentmonkey V4 Fixture')||
    !code.includes('// @namespace https://usshm.invalid/isolated-fixture'))
  throw new Error('Invalid fixed Violentmonkey userscript fixture');
 return buildViolentmonkeyManagerCommandExpression('ParseScript',{
  code,config:{enabled:1,httpOnly:0,notifyUpdates:null,shouldUpdate:1},
  custom:{},isNew:true,message:'',bumpDate:true,
 },0x7ffffffd,`
   const scriptId=value?.where?.id;
   const rawErrors=value?.errors;
   const errors=rawErrors===null?null:Array.isArray(rawErrors)&&rawErrors.length===0?[]:[true];
   const isNew=value?.isNew===true?true:value?.isNew===false?false:undefined;
   finish(JSON.stringify({failed:false,where:{id:Number.isSafeInteger(scriptId)&&scriptId>0?scriptId:null},isNew,errors}));`);
}

/** Validate the exact bounded receipt returned by the pinned ParseScript API. */
export function assertViolentmonkeyInstallReceipt(
 receipt:unknown,
 priorScriptAbsent:boolean,
):Readonly<{scriptId:number}>{
 const reject=(reason:'preexisting-script'|'envelope'|'script-location'|'not-new-script'|'parser-errors'|'script-id'):never=>{
  throw new Error(`Violentmonkey install receipt rejected: ${reason}`);
 };
 if(priorScriptAbsent!==true)reject('preexisting-script');
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))
  reject('envelope');
 const value=receipt as {where?:unknown;isNew?:unknown;errors?:unknown};
 if(!value.where||typeof value.where!=='object'||Array.isArray(value.where))
  reject('script-location');
 // The official ParseScript wrapper may omit isNew from its callback receipt.
 // A read-only manager inventory preflight proves absence; explicit false wins.
 if('isNew' in value&&value.isNew!==true)reject('not-new-script');
 if(value.errors!==null&&(!Array.isArray(value.errors)||value.errors.length!==0))
  reject('parser-errors');
 const scriptId=(value.where as {id?:unknown}).id;
 if(!Number.isSafeInteger(scriptId)||typeof scriptId!=='number'||scriptId<1)
  reject('script-id');
 return Object.freeze({scriptId});
}

export interface ViolentmonkeyFixtureObservation{
 readonly chromeProduct:string;
 readonly managerVersion:string;
 readonly managerExtensionId:string;
 readonly observedManagers:readonly string[];
 /** The product application's verification projection must remain conservative. */
 readonly appV4:string;
 readonly appManagerVerified:boolean;
 readonly fixture:{
  readonly storageBefore:number;
  readonly storageAfter:number;
  readonly storageReadback:number;
  readonly menuCommandId:string;
  readonly requestStatus:number;
  readonly requestBody:string;
 };
}

/**
 * Accept only the complete pinned-manager fixture. This validates test evidence;
 * it deliberately never upgrades the product's V4 or managerVerified fields.
 */
export function assertViolentmonkeyV4FixtureObservation(
 observation:ViolentmonkeyFixtureObservation,
 expectedCounterBefore:number,
):Readonly<{
 status:'fixture-passed';manager:'violentmonkey';version:'2.49.0';
 apis:readonly string[];V4:'not-configured';managerVerified:false;productionEligible:false;
}>{
 const fail=()=>{throw new Error('Violentmonkey fixture evidence incomplete or inconsistent');};
 if(!observation||!Number.isSafeInteger(expectedCounterBefore)||expectedCounterBefore<0||expectedCounterBefore>2||
    typeof observation.chromeProduct!=='string'||
    !/^(?:Chrome|HeadlessChrome)\/155\./.test(observation.chromeProduct)||
    observation.managerVersion!==VIOLENTMONKEY_CFT_RELEASE.version||
    observation.managerExtensionId!==VIOLENTMONKEY_CFT_RELEASE.extensionId||
    !Array.isArray(observation.observedManagers)||!observation.observedManagers.includes('violentmonkey')||
    observation.appV4!=='not-configured'||observation.appManagerVerified!==false)
  fail();
 const fixture=observation.fixture;
 if(!fixture||fixture.storageBefore!==expectedCounterBefore||
    fixture.storageAfter!==expectedCounterBefore+1||
    fixture.storageReadback!==expectedCounterBefore+1||
    fixture.menuCommandId!=='usshm-v4-fixture-menu'||
    fixture.requestStatus!==200||fixture.requestBody!=='USSHM_GM_REQUEST_OK')
  fail();
 return Object.freeze({
  status:'fixture-passed',manager:'violentmonkey',version:'2.49.0',
  apis:Object.freeze(['GM_getValue','GM_setValue','GM_registerMenuCommand','GM_xmlhttpRequest']),
  V4:'not-configured',managerVerified:false,productionEligible:false,
 });
}
