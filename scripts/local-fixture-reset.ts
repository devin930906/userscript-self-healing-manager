import type {ChromeTarget} from '../packages/cdp-client/src/index.ts';
import {validateCdpPageSocket} from '../packages/cdp-client/src/endpoint.ts';
import {assessSyntheticActionBoundary} from '../packages/test-runner/src/synthetic-action-boundary.ts';
import type {SocketLike} from '../packages/cdp-client/src/snapshot.ts';

/**
 * TEST-ONLY cleanup of an app-owned disposable loopback fixture. Never expose
 * via Electron, accept an arbitrary URL or import into product V2. The only
 * emitted browser command is Page.reload, not JS evaluation or user input.
 */
export async function reloadOwnedSyntheticFixture({
 approved,target,fixtureUrl,socketFactory,timeoutMs=4000,
}:{
 readonly approved:boolean;readonly target:ChromeTarget;readonly fixtureUrl:string;
 readonly socketFactory?:(endpoint:string)=>SocketLike;readonly timeoutMs?:number;
}):Promise<void>{
 assessSyntheticActionBoundary({approved,action:'fixture-test-click',
  elementId:'fixture-safe-click',target,fixtureUrl});
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)
  throw new Error('Invalid synthetic fixture cleanup time budget');
 const endpoint=validateCdpPageSocket(target,9223);
 const socket=(socketFactory??((uri:string)=>new WebSocket(uri) as unknown as SocketLike))(endpoint);
 await new Promise<void>((resolve,reject)=>{
  let done=false;
  const close=(reason?:Error)=>{
   if(done)return;done=true;clearTimeout(timer);
   for(const [event,fn] of listeners)socket.removeEventListener(event,fn);
   try{socket.close();}catch{}
   if(reason)reject(reason);else resolve();
  };
  const onOpen=()=>{
   try{socket.send(JSON.stringify({id:1,method:'Page.reload',params:{ignoreCache:true}}));}
   catch{close(new Error('Synthetic fixture reload could not be sent'));}
  };
  const onMessage=({data}:{data:unknown})=>{
   try{
    if(typeof data!=='string'||data.length>4096)
     throw new Error('Synthetic fixture cleanup response invalid');
    const msg:unknown=JSON.parse(data);
    if(!msg||typeof msg!=='object'||Array.isArray(msg))
     throw new Error('Synthetic fixture cleanup response invalid');
    const received=msg as {id?:unknown;error?:unknown;result?:unknown};
    if(received.id!==1)return;
    if(received.error||!received.result||typeof received.result!=='object'||
       Array.isArray(received.result))
     throw new Error('Synthetic fixture CDP reload rejected');
    close();
   }catch{close(new Error('Synthetic fixture cleanup CDP response invalid'));}
  };
  const onError=()=>close(new Error('Synthetic fixture cleanup CDP socket error'));
  const onClose=()=>close(new Error('Synthetic fixture cleanup CDP socket closed'));
  const listeners:Array<['open'|'message'|'error'|'close',(e:any)=>void]>=[
   ['open',onOpen],['message',onMessage],['error',onError],['close',onClose]];
  const timer=setTimeout(()=>close(new Error('Synthetic fixture reload timeout')),timeoutMs);
  for(const [event,fn] of listeners)socket.addEventListener(event,fn);
 });
}
