/**
 * RG-05 disposable Chrome 155 fixture diagnostic only.
 *
 * Pinned official Violentmonkey v2.49.0 webpack defines the global
 * "**VMInitInjection**" and its injected content entry sets it to literal 1
 * (src/injected/content/inject.js). Looking up this fixed own-data descriptor
 * is passive: it does NOT run GetInjected, read script sources, dispatch a
 * user script, grant permission or initialize the manager.
 *
 * A positive flag narrows which bootstrap instructions executed. It never
 * certifies the content bridge, GM APIs, or product V4.
 */
const MARKER_EXPRESSION=`(()=>{try{
 const descriptor=Object.getOwnPropertyDescriptor(window,"**VMInitInjection**");
 const value=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 const officialRuntimeId=typeof chrome==='object'&&chrome!==null&&
  chrome.runtime?.id==='jinjaccalgkegednnccohejagnlnfdag';
 return JSON.stringify({
  readyMarker:value===1,webBootstrap:typeof value==='function',
  officialRuntimeId:!!officialRuntimeId,
 });
 }catch{return JSON.stringify({readyMarker:false,webBootstrap:false,officialRuntimeId:false});}})()`;
type CdpSend=(method:string,params:Record<string,unknown>)=>Promise<unknown>;
export interface PinnedBootstrapMarkerEvidence {
 readonly isolatedWorldsObserved:number;
 readonly worldsChecked:number;
 readonly readyMarkerObserved:boolean;
 readonly webBootstrapObserved:boolean;
 readonly officialRuntimeIdObserved:boolean;
 readonly observationIncomplete:boolean;
}
export function createPinnedBootstrapMarkerEvidence(frameId:string){
 if(typeof frameId!=='string'||!frameId||frameId.length>256)
  throw new Error('Invalid pinned fixture frame identity');
 const contexts=new Set<number>();
 let truncated=false;
 return {
  observe(method:string,params:unknown):void{
   if(method==='Runtime.executionContextsCleared'){
    contexts.clear();truncated=false;
   }else if(method==='Runtime.executionContextDestroyed'){
    const id=(params as {executionContextId?:unknown}|null)?.executionContextId;
    if(Number.isSafeInteger(id))contexts.delete(id as number);
   }else if(method==='Runtime.executionContextCreated'){
    const context=(params as {context?:unknown}|null)?.context;
    if(!context||typeof context!=='object'||Array.isArray(context))return;
    const obj=context as {id?:unknown;auxData?:unknown};
    const aux=obj.auxData;
    if(!aux||typeof aux!=='object'||Array.isArray(aux))return;
    const meta=aux as {frameId?:unknown;isDefault?:unknown};
    if(meta.frameId!==frameId||meta.isDefault!==false||
       !Number.isSafeInteger(obj.id)||(obj.id as number)<=0)return;
    if(contexts.size>=8&&!contexts.has(obj.id as number)){truncated=true;return;}
    contexts.add(obj.id as number);
   }
  },
  async read(send:CdpSend):Promise<PinnedBootstrapMarkerEvidence>{
   let worldsChecked=0,readyMarkerObserved=false,webBootstrapObserved=false,officialRuntimeIdObserved=false;
   let incomplete=truncated||contexts.size===0;
   for(const contextId of contexts){
    try{
     const response=await send('Runtime.evaluate',{
      expression:MARKER_EXPRESSION,contextId,returnByValue:true,awaitPromise:false,
     });
     if(!response||typeof response!=='object'||Array.isArray(response)||
        Object.hasOwn(response,'error')){incomplete=true;continue;}
     const packet=response as {result?:{value?:unknown};exceptionDetails?:unknown};
     if(Object.hasOwn(packet,'exceptionDetails')||
        !packet.result||typeof packet.result!=='object'||
        Array.isArray(packet.result)||
        Object.hasOwn(packet.result,'exceptionDetails')||
        Object.hasOwn(packet.result,'error')||
        typeof packet.result.value!=='string'||
        packet.result.value.length>100){incomplete=true;continue;}
     const parsed:unknown=JSON.parse(packet.result.value);
     if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
        Object.keys(parsed).sort().join(',')!=='officialRuntimeId,readyMarker,webBootstrap'||
        typeof (parsed as {readyMarker?:unknown}).readyMarker!=='boolean'||
        typeof (parsed as {webBootstrap?:unknown}).webBootstrap!=='boolean'||
        typeof (parsed as {officialRuntimeId?:unknown}).officialRuntimeId!=='boolean'){
      incomplete=true;continue;
     }
     worldsChecked++;
     if((parsed as {readyMarker:boolean}).readyMarker)readyMarkerObserved=true;
     if((parsed as {webBootstrap:boolean}).webBootstrap)webBootstrapObserved=true;
     if((parsed as {officialRuntimeId:boolean}).officialRuntimeId)officialRuntimeIdObserved=true;
    }catch{
     // CDP may destroy a context between observation and query.
     // Raw private CDP error text is NEVER returned or logged.
     incomplete=true;
    }
   }
   return {
    isolatedWorldsObserved:contexts.size,worldsChecked,
    readyMarkerObserved,webBootstrapObserved,officialRuntimeIdObserved,
    observationIncomplete:incomplete,
   };
  },
 };
}
