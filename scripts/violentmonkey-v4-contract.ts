import {createHash} from 'node:crypto';

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

/**
 * Build a fixed-shape query using Violentmonkey's official MV3 client/SW
 * channel. The manager's extension page reduces its own script inventory to
 * one boolean before the CDP caller receives any response.
 */
function buildViolentmonkeyManagerCommandExpression(
 command:'GetData'|'ParseScript',data:Record<string,unknown>,requestId:number,responseCode:string,
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
