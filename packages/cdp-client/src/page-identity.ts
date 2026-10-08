import type {ChromeTarget} from './index.ts';
import {validateCdpPageSocket} from './endpoint.ts';
import type {SocketLike} from './snapshot.ts';

export interface ConfirmedPageIdentity {targetId:string;confirmedUrl:string}

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
    if(typeof url!=='string'||url.length>8192||!url)throw new Error('Invalid CDP frame tree URL');
    if(url!==target.url)throw new Error('CDP page URL changed or frame identity mismatch');
    complete(undefined,{targetId:target.id,confirmedUrl:url});
   }catch(error){complete(error instanceof Error?error:new Error('Invalid CDP frame tree'));}
  };
  const onError=()=>complete(new Error('CDP page identity socket error'));
  const onClose=()=>complete(new Error('CDP page identity socket closed before response'));
  const handlers:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[['open',onOpen],['message',onMessage],['error',onError],['close',onClose]];
  const timer=setTimeout(()=>complete(new Error('CDP page identity timeout')),timeoutMs);
  for(const [name,handler] of handlers)socket.addEventListener(name,handler);
 });
}
