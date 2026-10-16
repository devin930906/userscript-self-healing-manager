import {VIOLENTMONKEY_CFT_RELEASE} from './violentmonkey-v4-contract.ts';

export type OfficialManagerWorkerCensus=Readonly<{
 status:'observed'|'unavailable';
 serviceWorkers:number|null;
 backgroundPages:number|null;
}>;

/** Safe, data-only read of a CDP TargetInfo field. Never execute accessors. */
function ownData(value:unknown,key:string):unknown{
 try{
  if(value===null||typeof value!=='object'||Array.isArray(value))return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 }catch{return undefined;}
}
const unavailable=():OfficialManagerWorkerCensus=>Object.freeze({
 status:'unavailable',serviceWorkers:null,backgroundPages:null,
});

/**
 * RG-05 TEST ONLY: a passive Target.getTargets census for the pinned official
 * extension, collected AFTER real GM receipts/misses. Zero merely means no
 * matching target was observed in this snapshot. It does NOT prove a broken
 * service worker, stopped extension, missing GM capability or product V4.
 *
 * Never return a CDP target ID, URL, script, source or extension metadata.
 * Hostile/inherited/accessor-backed/incomplete CDP data fails closed.
 */
export function summarizeOfficialManagerWorkerTargets(response:unknown):OfficialManagerWorkerCensus{
 const prefix='chrome-extension://'+VIOLENTMONKEY_CFT_RELEASE.extensionId+'/';
 let serviceWorkers=0,backgroundPages=0;
 try{
  // A protocol-error CDP envelope is never target evidence, even if its
  // error value is falsy and a forged targetInfos payload is also present.
  // The `in` checks do not invoke getters; hostile Proxy traps fail closed.
  if(!response||typeof response!=='object'||Array.isArray(response)||
     'error' in response||'exceptionDetails' in response)return unavailable();
  const infos=ownData(response,'targetInfos');
  if(!Array.isArray(infos)||infos.length>512)return unavailable();
  for(let index=0;index<infos.length;index++){
   const entry=Object.getOwnPropertyDescriptor(infos,String(index));
   if(!entry||!Object.hasOwn(entry,'value'))return unavailable();
   const kind=ownData(entry.value,'type');
   const url=ownData(entry.value,'url');
   if(typeof kind!=='string'||kind.length>64||
      typeof url!=='string'||url.length>2048)return unavailable();
   if(!url.startsWith(prefix))continue;
   if(kind==='service_worker')serviceWorkers++;
   else if(kind==='background_page')backgroundPages++;
  }
 }catch{return unavailable();}
 return Object.freeze({status:'observed',serviceWorkers,backgroundPages});
}
