import type {ChromeTarget} from './index.ts';
import {validateCdpPageSocket} from './endpoint.ts';
import {asCss,type LiteralLocator} from './locator-probe.ts';
import type {SocketLike} from './snapshot.ts';

export type DirectListenerStatus='registered'|'none-observed'|'missing'|'ambiguous'|'unknown';
export interface ReadOnlyEventListenerEvidence {
 readonly targetId:string;
 readonly url:string;
 readonly status:DirectListenerStatus;
 readonly listenerCount:number|null;
 readonly eventType:'click';
 readonly validationLevel:'direct-event-listener-read-only';
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
 readonly interactionVerified:false;
}
/**
 * Direct click listener metadata for exactly one static top-document node.
 * NEVER dispatches Input events, runs page JS, returns listener handlers,
 * inspects other frames, or guesses that absence of direct listeners means
 * absence of delegated, inline, framework-managed or userscript behavior.
 * A nonzero listener count is only registration evidence, not V2 success.
 */
export async function inspectReadOnlyEventListeners(target:ChromeTarget,locator:LiteralLocator,
 options:{socketFactory?:(url:string)=>SocketLike;timeoutMs?:number}={},
):Promise<ReadOnlyEventListenerEvidence>{
 const css=locator&&asCss(locator);
 if(!css||locator.runtimeRequired||css.length>1024)
  throw new Error('Supported static literal CSS selector required');
 const endpoint=validateCdpPageSocket(target);
 const timeoutMs=options.timeoutMs??6500;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)
  throw new Error('Invalid event listener timeout budget');
 const result=(status:DirectListenerStatus,listenerCount:number|null=null):ReadOnlyEventListenerEvidence=>({
  targetId:target.id,url:target.url,status,listenerCount,eventType:'click',
  validationLevel:'direct-event-listener-read-only',
  V2:'blocked',V3:'not-configured',V4:'not-configured',interactionVerified:false,
 });
 const socket=(options.socketFactory??((url:string)=>new WebSocket(url) as unknown as SocketLike))(endpoint);
 return await new Promise<ReadOnlyEventListenerEvidence>((resolve,reject)=>{
  let finished=false,seq=0,expected=0,method='';
  let objectId:string|null=null,observed:ReadOnlyEventListenerEvidence|null=null;
  const send=(name:string,params:Record<string,unknown>={})=>{
   expected=++seq;method=name;
   socket.send(JSON.stringify({id:expected,method:name,params}));
  };
  const end=(error?:Error,evidence?:ReadOnlyEventListenerEvidence)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   for(const [name,callback] of listeners)socket.removeEventListener(name,callback);
   try{socket.close();}catch{}
   if(error)reject(error);
   else resolve(evidence??result('unknown'));
  };
  const release=(evidence:ReadOnlyEventListenerEvidence)=>{
   observed=evidence;
   if(!objectId){end(undefined,result('unknown'));return;}
   try{send('Runtime.releaseObject',{objectId});}
   catch{end(undefined,result('unknown'));}
  };
  const onOpen=()=>{try{send('DOM.getDocument',{depth:0,pierce:false});}
   catch{end(new Error('Cannot request CDP root for listener evidence'));}};
  const onMessage=(event:{data:unknown})=>{
   try{
    if(typeof event.data!=='string'||event.data.length>300000)
     throw new Error('Oversized or invalid listener CDP response');
    const m=JSON.parse(event.data);
    if(finished||m.id!==expected)return;
    if(m.error){
     if(objectId&&method!=='Runtime.releaseObject'){
      release(result('unknown'));return;
     }
     if(method==='Runtime.releaseObject'){end(undefined,result('unknown'));return;}
     if(method==='DOM.getDocument'){end(new Error('Cannot read CDP document root'));return;}
     end(undefined,result('unknown'));return;
    }
    switch(method){
     case 'DOM.getDocument':{
      const root=m.result?.root?.nodeId;
      if(!Number.isSafeInteger(root)||root<1){end(undefined,result('unknown'));break;}
      send('DOM.querySelectorAll',{nodeId:root,selector:css});
      break;
     }
     case 'DOM.querySelectorAll':{
      const ids=m.result?.nodeIds;
      if(!Array.isArray(ids)||ids.length>10000||
         ids.some((id:unknown)=>!Number.isSafeInteger(id)||Number(id)<1)||
         new Set(ids).size!==ids.length){
       end(undefined,result('unknown'));break;
      }
      if(ids.length===0){end(undefined,result('missing'));break;}
      if(ids.length>1){end(undefined,result('ambiguous'));break;}
      send('DOM.resolveNode',{nodeId:ids[0]});
      break;
     }
     case 'DOM.resolveNode':{
      const remote=m.result?.object?.objectId;
      if(typeof remote!=='string'||remote.length<1||remote.length>1024){
       end(undefined,result('unknown'));break;
      }
      objectId=remote;
      send('DOMDebugger.getEventListeners',{objectId:remote,depth:0,pierce:false});
      break;
     }
     case 'DOMDebugger.getEventListeners':{
      const entries=m.result?.listeners;
      if(!Array.isArray(entries)||entries.length>512||
         entries.some((entry:unknown)=>!entry||typeof entry!=='object'||
          typeof (entry as Record<string,unknown>).type!=='string'||
          (entry as {type:string}).type.length>128)){
       release(result('unknown'));break;
      }
      const clickCount=entries.filter((entry:{type:string})=>entry.type==='click').length;
      release(result(clickCount>0?'registered':'none-observed',clickCount));
      break;
     }
     case 'Runtime.releaseObject':{
      objectId=null;
      end(undefined,observed??result('unknown'));
      break;
     }
     default:throw new Error('Unexpected CDP listener inspection state');
    }
   }catch(error){
    if(objectId&&method!=='Runtime.releaseObject')release(result('unknown'));
    else end(error instanceof Error?error:new Error('Invalid CDP listener response'));
   }
  };
  const onError=()=>end(new Error('CDP listener socket error'));
  const onClose=()=>end(new Error('CDP listener connection closed'));
  const listeners:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[
   ['open',onOpen],['message',onMessage],['error',onError],['close',onClose],
  ];
  const timer=setTimeout(()=>end(new Error('CDP listener inspection timeout')),timeoutMs);
  for(const [name,callback] of listeners)socket.addEventListener(name,callback);
 });
}
