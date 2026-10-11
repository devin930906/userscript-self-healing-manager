import {createHmac,randomBytes} from 'node:crypto';
import type {ChromeTarget} from './index.ts';
import {validateCdpPageSocket} from './endpoint.ts';
import type {SocketLike} from './snapshot.ts';

export interface ConfirmedPageIdentity {targetId:string;confirmedUrl:string;subframeCount?:number;frameId?:string;loaderId?:string;
 /** Only exactly one same-origin child with a verified loader may be inspected.
  * Child URLs must not be exposed in UI or reports. */
 soleSameOriginSubframe?:Readonly<{frameId:string;loaderId:string;urlFingerprint?:string}>}
// Process-private key: never expose, persist or log child browsing-context URLs.
const CHILD_URL_KEY=randomBytes(32);
/** A URL can stay identical across reloads. Retain main-frame + document loader identity
 * for the duration of one read-only operation; never expose this token in UI reports. */
export function assertStablePageDocument(before:ConfirmedPageIdentity,after:ConfirmedPageIdentity):void{
 if(before.targetId!==after.targetId||before.confirmedUrl!==after.confirmedUrl||
    before.frameId!==after.frameId||before.loaderId!==after.loaderId||
    before.subframeCount!==after.subframeCount||
    before.soleSameOriginSubframe?.frameId!==after.soleSameOriginSubframe?.frameId||
    before.soleSameOriginSubframe?.loaderId!==after.soleSameOriginSubframe?.loaderId||
    before.soleSameOriginSubframe?.urlFingerprint!==after.soleSameOriginSubframe?.urlFingerprint)
  throw new Error('CDP main-frame document identity changed during inspection (same-URL navigation or reload)');
}

/**
 * Validate the live top-level frame rather than trusting a potentially stale
 * /json/list URL. Read-only Page domain command; no Runtime.evaluate and no DOM
 * content is returned. A later navigation must still be guarded by another call.
 */
export async function confirmPageIdentity(
 target:ChromeTarget,
 options:{socketFactory?:(url:string)=>SocketLike;timeoutMs?:number}={},
):Promise<ConfirmedPageIdentity>{
 const endpoint=validateCdpPageSocket(target);
 const timeoutMs=options.timeoutMs??4000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw new Error('Invalid frame identity timeout');
 let expected:URL;
 try{expected=new URL(target.url);}catch{throw new Error('Invalid expected page URL');}
 if(!['http:','https:'].includes(expected.protocol))throw new Error('Only HTTP(S) page identity checks are supported');
 const socket=(options.socketFactory??((address:string)=>new WebSocket(address) as unknown as SocketLike))(endpoint);
 return new Promise<ConfirmedPageIdentity>((resolve,reject)=>{
  let finished=false;
  const complete=(error?:Error,result?:ConfirmedPageIdentity)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   for(const [name,handler] of handlers)socket.removeEventListener(name,handler);
   try{socket.close();}catch{}
   if(error)reject(error);
   else if(result)resolve(result);
  };
  const onOpen=()=>{
   try{socket.send(JSON.stringify({id:1,method:'Page.getFrameTree'}));}
   catch(error){complete(error instanceof Error?error:new Error('Cannot request CDP frame identity'));}
  };
  const onMessage=(event:{data:unknown})=>{
   try{
    if(typeof event.data!=='string'||event.data.length>256_000)throw new Error('Invalid CDP frame tree response size');
    const response=JSON.parse(event.data);
    if(response.id!==1)return;
    if(response.error)throw new Error('CDP frame tree rejected');
    const url=response.result?.frameTree?.frame?.url;
    if(typeof url!=='string'||url.length>8192||!url)throw new Error('Invalid CDP frame tree URL (urlType='+typeof url+', responseFields='+Object.keys(response.result??{}).slice(0,5).join(',')+')');
    if(url!==target.url)throw new Error('CDP page URL changed or frame identity mismatch');
    // Record only the number of nested browsing contexts; never expose child
    // URLs (which could contain private query parameters) to UI/reports.
    // Depth and count are bounded independently of the WebSocket response cap.
    const frameTree=response.result?.frameTree;
    const queue:unknown[]=[frameTree];
    let nestedFrames=0;
    for(let index=0;index<queue.length;index++){
     const node=queue[index] as {frame?:{id?:unknown};childFrames?:unknown}|null;
     if(!node||!node.frame||typeof node.frame.id!=='string')
      throw new Error('Invalid nested CDP frame tree');
     if(node.childFrames!==undefined){
      if(!Array.isArray(node.childFrames))throw new Error('Invalid nested CDP frame list');
      nestedFrames+=node.childFrames.length;
      if(nestedFrames>64)throw new Error('CDP nested frame limit exceeded');
      queue.push(...node.childFrames);
     }
    }
    const topFrame=frameTree.frame as {id:string;loaderId?:unknown};
    const frameId=topFrame.id;
    const loaderId=topFrame.loaderId;
    if(frameId.length>256||typeof loaderId!=='string'||!loaderId||loaderId.length>256)
     throw new Error('Invalid main-frame document identity token');
    // A single same-origin child is the only nested scope that can be
    // identified unambiguously without a user-supplied frame selector.
    // Its loader is pinned alongside the main document before both CDP samples.
    // about:blank/srcdoc and cross-origin children are deliberately unsupported.
    let soleSameOriginSubframe:Readonly<{frameId:string;loaderId:string;urlFingerprint?:string}>|undefined;
    if(nestedFrames===1&&Array.isArray(frameTree.childFrames)&&frameTree.childFrames.length===1){
     const child=frameTree.childFrames[0]?.frame;
     const childId=child?.id,childLoader=child?.loaderId,childUrl=child?.url;
     if(typeof childId==='string'&&childId.length>0&&childId.length<=256&&
        typeof childLoader==='string'&&childLoader.length>0&&childLoader.length<=256&&
        typeof childUrl==='string'&&childUrl.length<=8192){
      try{
       const parsedChild=new URL(childUrl);
       if(['http:','https:'].includes(parsedChild.protocol)&&parsedChild.origin===expected.origin)
        soleSameOriginSubframe={frameId:childId,loaderId:childLoader,
         urlFingerprint:createHmac('sha256',CHILD_URL_KEY)
          .update('usshm-iframe-url-v1:').update(childUrl).digest('hex')};
      }catch{/* Invalid or opaque nested URLs do not authorize iframe reads. */}
     }
    }
    complete(undefined,{targetId:target.id,confirmedUrl:url,frameId,
     loaderId,
     ...(nestedFrames>0?{subframeCount:nestedFrames}:{}),
     ...(soleSameOriginSubframe?{soleSameOriginSubframe}:{})});
   }catch(error){complete(error instanceof Error?error:new Error('Invalid CDP frame tree'));}
  };
  const onError=()=>complete(new Error('CDP page identity socket error'));
  const onClose=()=>complete(new Error('CDP page identity socket closed before response'));
  const handlers:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[['open',onOpen],['message',onMessage],['error',onError],['close',onClose]];
  const timer=setTimeout(()=>complete(new Error('CDP page identity timeout')),timeoutMs);
  for(const [name,handler] of handlers)socket.addEventListener(name,handler);
 });
}
