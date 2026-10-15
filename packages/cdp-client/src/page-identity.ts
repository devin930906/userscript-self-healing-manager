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
// Only these internal fixed codes may be surfaced outside the untrusted CDP
// socket. Parser errors and dynamic response fields can quote private data.
const SAFE_FRAME_DIAGNOSTICS=new Set([
 'Invalid CDP frame tree response size',
 'CDP frame tree rejected',
 'Invalid CDP frame tree URL',
 'CDP page URL changed or frame identity mismatch',
 'Invalid nested CDP frame tree',
 'Invalid nested CDP frame list',
 'CDP nested frame limit exceeded',
 'Invalid main-frame document identity token',
]);
/** A URL can stay identical across reloads. Retain main-frame + document loader identity
 * for the duration of one read-only operation; never expose this token in UI reports. */
export function assertStablePageDocument(before:ConfirmedPageIdentity,after:ConfirmedPageIdentity):void{
 // Do not accept two matching forged/incomplete child receipts as proof of
 // stability. Only confirmPageIdentity's single-child, digest-bound shape
 // may authorize a child scope; unsupported children remain count-only.
 const validChild=(item:ConfirmedPageIdentity):boolean=>{
  const count=item.subframeCount;
  if(count!==undefined&&(!Number.isSafeInteger(count)||count<0||count>64))return false;
  const child=item.soleSameOriginSubframe;
  if(child===undefined)return true;
  return count===1&&child!==null&&
   typeof child.frameId==='string'&&child.frameId.length>0&&child.frameId.length<=256&&
   child.frameId!==item.frameId&&
   typeof child.loaderId==='string'&&child.loaderId.length>0&&child.loaderId.length<=256&&
   typeof child.urlFingerprint==='string'&&/^[a-f0-9]{64}$/.test(child.urlFingerprint);
 };
 // Two absent (or invalid) tokens comparing equal is not proof that a
 // same-URL navigation did not happen. Require the actual live document
 // identity on both sides before any equality comparison can pass.
 const pinned=(item:ConfirmedPageIdentity):boolean=>!!item&&
  typeof item.targetId==='string'&&item.targetId.length>0&&
  typeof item.confirmedUrl==='string'&&item.confirmedUrl.length>0&&
  typeof item.frameId==='string'&&item.frameId.length>0&&item.frameId.length<=256&&
  typeof item.loaderId==='string'&&item.loaderId.length>0&&item.loaderId.length<=256&&
  validChild(item);
 if(!pinned(before)||!pinned(after))
  throw new Error('CDP main-frame document identity unavailable during inspection');
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
 let expectedUrl:string;
 try{
  expectedUrl=target.url;
  if(typeof expectedUrl!=='string'||expectedUrl.length<1||expectedUrl.length>8192)throw new Error('Invalid URL');
  expected=new URL(expectedUrl);
 }catch{throw new Error('Invalid expected page URL');}
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
   catch{complete(new Error('Cannot request CDP frame identity'));}
  };
  const onMessage=(event:{data:unknown})=>{
   try{
    if(typeof event.data!=='string'||event.data.length>256_000)throw new Error('Invalid CDP frame tree response size');
    const response=JSON.parse(event.data);
    if(response.id!==1)return;
    if(Object.hasOwn(response,'error'))throw new Error('CDP frame tree rejected');
    const url=response.result?.frameTree?.frame?.url;
    if(typeof url!=='string'||url.length>8192||!url)throw new Error('Invalid CDP frame tree URL');
    if(url!==expectedUrl)throw new Error('CDP page URL changed or frame identity mismatch');
    // Record only the number of nested browsing contexts; never expose child
    // URLs (which could contain private query parameters) to UI/reports.
    // Depth and count are bounded independently of the WebSocket response cap.
    const frameTree=response.result?.frameTree;
    const queue:unknown[]=[frameTree];
    let nestedFrames=0;
    const observedFrameIds=new Set<string>();
    for(let index=0;index<queue.length;index++){
     const node=queue[index] as {frame?:{id?:unknown};childFrames?:unknown}|null;
     if(!node||!node.frame||typeof node.frame.id!=='string'||
        (index>0&&(!node.frame.id||node.frame.id.length>256)))
      throw new Error('Invalid nested CDP frame tree');
     // A forged frame tree cannot grant a child scope using the main-frame ID
     // or another child's ID. Keep the check bounded by the frame-count cap.
     if(observedFrameIds.has(node.frame.id))
      throw new Error('Invalid nested CDP frame tree');
     observedFrameIds.add(node.frame.id);
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
    if(!frameId||frameId.length>256||typeof loaderId!=='string'||!loaderId||loaderId.length>256)
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
   }catch(error){
    const code=error instanceof Error&&SAFE_FRAME_DIAGNOSTICS.has(error.message)?
     error.message:'Invalid CDP frame tree response';
    complete(new Error(code));
   }
  };
  const onError=()=>complete(new Error('CDP page identity socket error'));
  const onClose=()=>complete(new Error('CDP page identity socket closed before response'));
  const handlers:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[['open',onOpen],['message',onMessage],['error',onError],['close',onClose]];
  const timer=setTimeout(()=>complete(new Error('CDP page identity timeout')),timeoutMs);
  for(const [name,handler] of handlers)socket.addEventListener(name,handler);
 });
}
