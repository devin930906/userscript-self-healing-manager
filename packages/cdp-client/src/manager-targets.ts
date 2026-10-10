import {validateCdpBrowserSocket} from './endpoint.ts';
import type {SocketLike} from './snapshot.ts';

/** Only exact extension IDs published by their projects' Chrome listings. */
const managerIds={
 dhdgffkkebhmkfjojejmpbldmpobfkfo:'tampermonkey-stable',
 gcalenpjmijncebpfijmoaglllgpjagf:'tampermonkey-beta',
 jinjaccalgkegednnccohejagnlnfdag:'violentmonkey',
} as const;
export type KnownManagerTarget=typeof managerIds[keyof typeof managerIds];
export interface UserscriptManagerTargetReport {
 readonly level:'extension-target-observation-only';
 readonly observed:readonly KnownManagerTarget[];
 /** Manifest V3 service workers may sleep, even when extensions are installed. */
 readonly inactiveTargetsMayExist:true;
 readonly V4:'not-configured';
 readonly managerVerified:false;
}
const knownOrder:readonly KnownManagerTarget[]=[
 'tampermonkey-stable','tampermonkey-beta','violentmonkey',
];
/**
 * Read-only browser-level discovery. Observed background/worker targets with
 * known publisher IDs are *not* proof of installation, injection, script
 * execution, grants, storage permissions or GM_* behavior.
 *
 * Never attach, wake a worker, evaluate JavaScript, enumerate extension
 * storage or return the private browser target list to a renderer.
 */
export async function inspectKnownUserscriptManagerTargets({
 approved,browserEndpoint,expectedProduct,port=9223,socketFactory,timeoutMs=5000,
}:{
 approved:boolean;browserEndpoint:string;expectedProduct:string;port?:number;
 socketFactory?:(url:string)=>SocketLike;timeoutMs?:number;
}):Promise<UserscriptManagerTargetReport>{
 if(approved!==true)throw new Error('Explicit manager target observation consent required');
 const endpoint=validateCdpBrowserSocket(browserEndpoint,port);
 if(typeof expectedProduct!=='string'||expectedProduct.length>128||
    !/^(?:Chrome|Chromium|HeadlessChrome)\/[0-9]+(?:\.[0-9]+)*$/.test(expectedProduct))
  throw new Error('Verified Chrome browser product required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)
  throw new Error('Invalid manager discovery timeout');
 const socket=(socketFactory??((url:string)=>new WebSocket(url) as unknown as SocketLike))(endpoint);
 return await new Promise<UserscriptManagerTargetReport>((resolve,reject)=>{
  let done=false,id=0,expected=0,method:'Browser.getVersion'|'Target.getTargets'='Browser.getVersion';
  const finish=(error?:Error,report?:UserscriptManagerTargetReport)=>{
   if(done)return;done=true;clearTimeout(timer);
   for(const [event,handler] of events)socket.removeEventListener(event,handler);
   try{socket.close();}catch{}
   if(error)reject(error);
   else if(report)resolve(report);
   else reject(new Error('Incomplete CDP manager target observation'));
  };
  const send=(next:'Browser.getVersion'|'Target.getTargets')=>{
   method=next;expected=++id;socket.send(JSON.stringify({id:expected,method:next}));
  };
  const onOpen=()=>{try{send('Browser.getVersion');}catch{
   finish(new Error('Cannot request read-only Chrome version'));
  }};
  const onMessage=(event:{data:unknown})=>{
   try{
    if(typeof event.data!=='string'||event.data.length>512000)
     throw new Error('Invalid CDP manager target response budget');
    const raw:unknown=JSON.parse(event.data);
    if(!raw||typeof raw!=='object'||Array.isArray(raw))
     throw new Error('Invalid CDP manager target envelope');
    const message=raw as {id?:unknown;error?:unknown;result?:any};
    if(done||message.id!==expected)return;
    if(message.error||!message.result||typeof message.result!=='object'||
       Array.isArray(message.result))
     throw new Error('Chrome manager target request rejected or invalid');
    if(method==='Browser.getVersion'){
     if(message.result.product!==expectedProduct)
      throw new Error('Chrome browser identity changed during manager target observation');
     send('Target.getTargets');
     return;
    }
    const entries:unknown=message.result.targetInfos;
    if(!Array.isArray(entries)||entries.length>512)
     throw new Error('Invalid Chrome manager target inventory budget');
    const seenIds=new Set<string>();
    const managers=new Set<KnownManagerTarget>();
    for(const rawInfo of entries){
     if(!rawInfo||typeof rawInfo!=='object'||Array.isArray(rawInfo))
      throw new Error('Invalid Chrome manager target entry');
     const target=rawInfo as {targetId?:unknown;type?:unknown;url?:unknown};
     if(typeof target.targetId!=='string'||target.targetId.length<1||
        target.targetId.length>128||seenIds.has(target.targetId)||
        typeof target.type!=='string'||target.type.length>64||
        typeof target.url!=='string'||target.url.length>8192)
      throw new Error('Invalid or duplicate Chrome manager target identity');
     seenIds.add(target.targetId);
     if(target.type!=='service_worker'&&target.type!=='background_page')continue;
     const match=/^chrome-extension:\/\/([a-p]{32})\/[A-Za-z0-9_./%?&#=~-]{0,8192}$/.exec(target.url);
     if(!match)continue;
     const idKey=match[1] as keyof typeof managerIds;
     if(Object.prototype.hasOwnProperty.call(managerIds,idKey))managers.add(managerIds[idKey]);
    }
    finish(undefined,Object.freeze({
     level:'extension-target-observation-only',
     observed:Object.freeze(knownOrder.filter(m=>managers.has(m))),
     inactiveTargetsMayExist:true,
     V4:'not-configured',
     managerVerified:false,
    }));
   }catch{
    finish(new Error('CDP manager target discovery failed or returned inconsistent evidence'));
   }
  };
  const onError=()=>finish(new Error('CDP manager target socket error'));
  const onClose=()=>finish(new Error('CDP manager target socket closed'));
  const events:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[
   ['open',onOpen],['message',onMessage],['error',onError],['close',onClose],
  ];
  const timer=setTimeout(()=>finish(new Error('CDP manager target timeout')),timeoutMs);
  for(const [event,handler] of events)socket.addEventListener(event,handler);
 });
}
