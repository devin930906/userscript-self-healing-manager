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
  if(stages.includes(answer?.result?.value))stage=answer.result.value;
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
 command:'GetData'|'ParseScript'|'GetInjectorError',data:Record<string,unknown>,requestId:number,responseCode:string,
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
   if(packet.err)return finish(JSON.stringify({failed:true}));
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
 'worker-receipt-unavailable'|'official-injector-error'|'base-injector-unregistered'|'ready';

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
  }catch{throw new Error('Isolated manager injector CDP evaluation failed');}
  if(response?.exceptionDetails)
   throw new Error('Isolated manager injector CDP evaluation failed');
  return response?.result?.value;
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
   finish(JSON.stringify({ready:value===undefined||value===null}));`);
}

/** Return only a boolean for the exact pinned manager's base injector files. */
export function buildViolentmonkeyInjectorProbeExpression():string{
 return `(async()=>{
  try{
   const scripts=await chrome.userScripts.getScripts({ids:['1001']});
   const script=Array.isArray(scripts)&&scripts.length===1?scripts[0]:null;
   const ready=script?.id==='1001'&&script.runAt==='document_start'&&script.allFrames===true&&
    Array.isArray(script.js)&&script.js.length===2&&script.js[0]?.file==='injected-web.js'&&
    script.js[1]?.file==='injected.js'&&!script.js.some(item=>'code' in item)&&
    Array.isArray(script.matches)&&script.matches.includes('<all_urls>');
   return JSON.stringify({ready:!!ready});
  }catch{return JSON.stringify({ready:false});}
 })()`;
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
 if(!observation||!Number.isSafeInteger(expectedCounterBefore)||expectedCounterBefore<0||expectedCounterBefore>1||
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
