import type {ChromeTarget} from './index.ts';
import {validateCdpPageSocket} from './endpoint.ts';
import {assertStablePageDocument,confirmPageIdentity,type ConfirmedPageIdentity} from './page-identity.ts';
import type {SocketLike} from './snapshot.ts';

const MAX_EXCEPTION_IDS=64;
const MAX_MESSAGES=256;
const MAX_MESSAGE_BYTES=300_000;
export interface PassivePageExceptionEvidence {
 readonly targetId:string;
 readonly status:'observed'|'none-observed'|'unknown';
 readonly observedCount:number|null;
 readonly validationLevel:'runtime-exception-count-only';
 /** A target-level event cannot reliably identify page vs extension vs userscript. */
 readonly origin:'unknown';
 readonly attribution:'unattributed';
 readonly userscriptVerified:false;
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
}
type ObserverOptions={
 readonly approved:boolean;
 readonly durationMs?:number;
 readonly socketFactory?:(url:string)=>SocketLike;
 readonly confirm?:(target:ChromeTarget)=>Promise<ConfirmedPageIdentity>;
};
function assertIdentity(target:ChromeTarget,identity:ConfirmedPageIdentity):void{
 if(!identity||identity.targetId!==target.id||identity.confirmedUrl!==target.url||
    typeof identity.frameId!=='string'||!identity.frameId||
    typeof identity.loaderId!=='string'||!identity.loaderId)
  throw new Error('CDP page document identity unverified for exception observation');
}

/**
 * Watch only CDP Runtime.exceptionThrown events for a short, explicitly
 * authorized window. This is *passive*: Runtime.enable/disable only, never
 * Runtime.evaluate, page script injection, navigation or DOM changes.
 *
 * Errors and stacks may contain credentials. They are parsed in-memory only
 * to count bounded exception IDs; no text/URL/stack/context is serialized.
 * Target-level events NEVER establish userscript (or webpage) blame.
 */
export async function observeReadOnlyPageExceptions(
 target:ChromeTarget,options:ObserverOptions,
):Promise<PassivePageExceptionEvidence>{
 if(options?.approved!==true)throw new Error('Explicit approval required for passive exception observation');
 const durationMs=options.durationMs??500;
 if(!Number.isSafeInteger(durationMs)||durationMs<100||durationMs>5000)
  throw new Error('Invalid passive exception observation duration budget');
 if(!target||target.type!=='page'||typeof target.id!=='string'||!target.id||
    typeof target.url!=='string'||!/^https?:\/\//i.test(target.url))
  throw new Error('Invalid CDP page target for exception observation');
 const endpoint=validateCdpPageSocket(target);
 const confirm=options.confirm??confirmPageIdentity;
 const before=await confirm(target);
 assertIdentity(target,before);
 const socket=(options.socketFactory??((url:string)=>new WebSocket(url) as unknown as SocketLike))(endpoint);
 const observed=await new Promise<{status:PassivePageExceptionEvidence['status'];count:number|null}>((resolve,reject)=>{
  let ended=false,method:'Runtime.enable'|'Runtime.disable'='Runtime.enable';
  let requestId=0,enabled=false,invalid=false,messages=0;
  const ids=new Set<number>();
  let observationTimer:ReturnType<typeof setTimeout>|undefined;
  const deadlineTimer=setTimeout(()=>finish(new Error('Passive CDP exception observation timed out')),durationMs+3500);
  const handlers:Array<['open'|'message'|'error'|'close',(e:any)=>void]>=[
   ['open',onOpen],['message',onMessage],['error',onError],['close',onClose],
  ];
  function finish(error?:Error){
   if(ended)return;
   ended=true;
   if(observationTimer!==undefined)clearTimeout(observationTimer);
   clearTimeout(deadlineTimer);
   for(const [name,handler] of handlers)socket.removeEventListener(name,handler);
   try{socket.close();}catch{}
   if(error){reject(error);return;}
   resolve(invalid?{status:'unknown',count:null}:
    {status:ids.size>0?'observed':'none-observed',count:ids.size});
  }
  function send(next:'Runtime.enable'|'Runtime.disable'){
   method=next;requestId++;
   socket.send(JSON.stringify({id:requestId,method:next}));
  }
  function stop(){
   if(ended||method==='Runtime.disable')return;
   try{send('Runtime.disable');}catch{finish(new Error('Could not stop passive exception observation'));}
  }
  function onOpen(){
   try{send('Runtime.enable');}
   catch{finish(new Error('Could not enable passive exception observation'));}
  }
  function onMessage(event:{data:unknown}){
   if(ended)return;
   try{
    if(typeof event.data!=='string'||event.data.length>MAX_MESSAGE_BYTES||++messages>MAX_MESSAGES){
     invalid=true;stop();return;
    }
    const raw:unknown=JSON.parse(event.data);
    if(!raw||typeof raw!=='object'||Array.isArray(raw)){
     invalid=true;stop();return;
    }
    const message=raw as {id?:unknown;method?:unknown;params?:unknown;error?:unknown;result?:unknown};
    if(message.id===requestId){
     if(message.error!==undefined||!message.result||typeof message.result!=='object'||Array.isArray(message.result)){
      // No error message from Chrome may escape.
      if(method==='Runtime.enable')finish(new Error('CDP Runtime exception observer rejected'));
      else{invalid=true;finish();}
      return;
     }
     if(method==='Runtime.enable'&&!enabled){
      enabled=true;
      observationTimer=setTimeout(stop,durationMs);
     }else if(method==='Runtime.disable')finish();
     return;
    }
    if(!enabled||method!=='Runtime.enable'||message.method!=='Runtime.exceptionThrown')return;
    const params=message.params;
    const details=params&&typeof params==='object'&&!Array.isArray(params)?
     (params as {exceptionDetails?:unknown}).exceptionDetails:null;
    const exceptionId=details&&typeof details==='object'&&!Array.isArray(details)?
     (details as {exceptionId?:unknown}).exceptionId:null;
    if(!Number.isSafeInteger(exceptionId)||Number(exceptionId)<0){
     invalid=true;stop();return;
    }
    ids.add(exceptionId as number);
    if(ids.size>MAX_EXCEPTION_IDS){invalid=true;stop();}
   }catch{
    // Untrusted event body is never exposed, and malformed evidence is not
    // reclassified as zero observed errors.
    invalid=true;stop();
   }
  }
  function onError(){finish(new Error('Passive CDP exception socket error'));}
  function onClose(){finish(new Error('Passive CDP exception socket closed'));}
  for(const [name,handler] of handlers)socket.addEventListener(name,handler);
 });
 // Even a matching URL is insufficient after a same-URL reload. Returning
 // counts from an old loader would be misleading.
 const after=await confirm(target);
 assertIdentity(target,after);
 assertStablePageDocument(before,after);
 return Object.freeze({
  targetId:target.id,status:observed.status,observedCount:observed.count,
  validationLevel:'runtime-exception-count-only',
  origin:'unknown',attribution:'unattributed',userscriptVerified:false,
  V2:'blocked',V3:'not-configured',V4:'not-configured',
 });
}
