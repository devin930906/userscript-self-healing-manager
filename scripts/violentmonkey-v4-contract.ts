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

/** Validate the exact bounded receipt returned by the pinned ParseScript API. */
export function assertViolentmonkeyInstallReceipt(
 receipt:unknown,
):Readonly<{scriptId:number}>{
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))
  throw new Error('Violentmonkey install receipt rejected');
 const value=receipt as {where?:unknown;isNew?:unknown;errors?:unknown};
 if(!value.where||typeof value.where!=='object'||Array.isArray(value.where)||value.isNew!==true||
    (value.errors!==null&&(!Array.isArray(value.errors)||value.errors.length!==0)))
  throw new Error('Violentmonkey install receipt rejected');
 const scriptId=(value.where as {id?:unknown}).id;
 if(!Number.isSafeInteger(scriptId)||typeof scriptId!=='number'||scriptId<1)
  throw new Error('Violentmonkey install receipt rejected');
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
