/**
 * RG-05 disposable CFT155/official Violentmonkey diagnostic only.
 * CDP Debugger.scriptParsed is parse visibility, NOT userscript execution,
 * completion or GM entitlement. Inspect only the pinned official extension's
 * two known registered injector assets for the already-verified fixture frame.
 * Never retain or export script URL, source text, CDP script IDs, or contexts.
 */
const OFFICIAL_EXTENSION_ID='jinjaccalgkegednnccohejagnlnfdag';
/** Decoded CDP payloads are data, never prototypes or accessor callbacks. */
function ownData(value:unknown,key:string):unknown{
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 try{
  const property=Object.getOwnPropertyDescriptor(value,key);
  return property&&Object.hasOwn(property,'value')?property.value:undefined;
 }catch{return undefined;}
}
export interface OfficialManagerScriptParseSnapshot {
 readonly injectedWebParsed:boolean;
 readonly injectedParsed:boolean;
}
export function createOfficialManagerScriptEvidence(frameId:string,extensionId:string){
 if(typeof frameId!=='string'||frameId.length<1||frameId.length>256||
    extensionId!==OFFICIAL_EXTENSION_ID)
  throw new Error('Invalid pinned official extension or fixture frame identity');
 const prefix='chrome-extension://'+OFFICIAL_EXTENSION_ID+'/';
 let injectedWebParsed=false,injectedParsed=false;
 return Object.freeze({
  observe(method:string,params:unknown):void{
   if(method!=='Debugger.scriptParsed'||!params||
      typeof params!=='object'||Array.isArray(params))return;
   const scriptId=ownData(params,'scriptId');
   const contextId=ownData(params,'executionContextId');
   const url=ownData(params,'url');
   const aux=ownData(params,'executionContextAuxData');
   if(typeof scriptId!=='string'||!scriptId||
      !Number.isSafeInteger(contextId)||(contextId as number)<1||
      typeof url!=='string'||ownData(aux,'frameId')!==frameId)return;
   if(url===prefix+'injected-web.js')injectedWebParsed=true;
   else if(url===prefix+'injected.js')injectedParsed=true;
  },
  snapshot():OfficialManagerScriptParseSnapshot{
   // No identifiers survive the reduction to fixed booleans.
   return Object.freeze({injectedWebParsed,injectedParsed});
  },
 });
}

/**
 * RG-05 isolated Windows CFT only. Attribute an already-observed CDP
 * exception to exactly one of the two pinned official injector *files*.
 * Never request or persist script source, script IDs, exception text, URLs,
 * call frames or private DOM. False means 'not observed', NOT 'not thrown'.
 */
export function createPinnedOfficialInjectorExceptionAttribution(frameId:string,extensionId:string){
 if(typeof frameId!=='string'||!frameId||frameId.length>256||
    extensionId!==OFFICIAL_EXTENSION_ID)
  throw new Error('Invalid pinned official extension or fixture frame identity');
 const prefix='chrome-extension://'+OFFICIAL_EXTENSION_ID+'/';
 const contexts=new Set<number>();
 const sources=new Map<string,{kind:'web'|'injected';contextId:number}>();
 let web=false,injected=false,unattributed=false;
 let injectedClass:'not-observed'|'unknown'|'mixed'|'TypeError'|'ReferenceError'|'SyntaxError'|'RangeError'|'Error'='not-observed';
 let injectedSignature:'not-observed'|'missing-injection-data-info'|'missing-runtime-onmessage-addlistener'|'other-type-error'|'unknown'|'mixed'='not-observed';
 // Public official extension asset coordinates only: never CDP messages, user
 // source lines, script IDs, private stack frames or exception description.
 let injectedSite='not-observed';
 return Object.freeze({
  observe(method:string,params:unknown):void{
   if(method==='Runtime.executionContextsCleared'){
    contexts.clear();sources.clear();return;
   }
   if(method==='Runtime.executionContextDestroyed'){
    const id=(params as {executionContextId?:unknown}|null)?.executionContextId;
    if(!Number.isSafeInteger(id))return;
    contexts.delete(id as number);
    for(const [key,value] of sources)if(value.contextId===id)sources.delete(key);
    return;
   }
   if(method==='Runtime.executionContextCreated'){
    const context=(params as {context?:unknown}|null)?.context;
    if(!context||typeof context!=='object'||Array.isArray(context))return;
    const obj=context as {id?:unknown;auxData?:unknown};
    const aux=obj.auxData;
    if(!aux||typeof aux!=='object'||Array.isArray(aux)||
       (aux as {frameId?:unknown;isDefault?:unknown}).frameId!==frameId||
       (aux as {isDefault?:unknown}).isDefault!==false||
       !Number.isSafeInteger(obj.id)||(obj.id as number)<1)return;
    if(contexts.size<8)contexts.add(obj.id as number);
    return;
   }
   if(method==='Debugger.scriptParsed'){
    if(!params||typeof params!=='object'||Array.isArray(params))return;
    const aux=ownData(params,'executionContextAuxData');
    const scriptId=ownData(params,'scriptId');
    const contextId=ownData(params,'executionContextId');
    const url=ownData(params,'url');
    if(ownData(aux,'frameId')!==frameId||
       typeof scriptId!=='string'||!scriptId||
       scriptId.length>128||!Number.isSafeInteger(contextId)||
       (contextId as number)<1||typeof url!=='string')return;
    const ctx=contextId as number;
    if(!contexts.has(ctx)){
     if(contexts.size>=8)return;
     contexts.add(ctx);
    }
    const kind=url===prefix+'injected-web.js'?'web':
     url===prefix+'injected.js'?'injected':null;
    if(kind&&sources.size<32)sources.set(scriptId,{kind,contextId:ctx});
    return;
   }
   if(method!=='Runtime.exceptionThrown')return;
   const details=(params as {exceptionDetails?:unknown}|null)?.exceptionDetails;
   if(!details||typeof details!=='object'||Array.isArray(details))return;
   const event=details as {scriptId?:unknown;executionContextId?:unknown};
   if(!Number.isSafeInteger(event.executionContextId)||
      !contexts.has(event.executionContextId as number))return;
   const source=typeof event.scriptId==='string'?sources.get(event.scriptId):undefined;
   if(source&&source.contextId===event.executionContextId){
    if(source.kind==='web')web=true;
    else{
     injected=true;
     const exception=(event as {exception?:unknown}).exception;
     const cls=exception&&typeof exception==='object'&&!Array.isArray(exception)
      ?(exception as {className?:unknown}).className:undefined;
     const allow=['TypeError','ReferenceError','SyntaxError','RangeError','Error'];
     const next:typeof injectedClass=typeof cls==='string'&&allow.includes(cls)
      ?cls as typeof injectedClass:'unknown';
     injectedClass=injectedClass==='not-observed'?next:
      injectedClass===next?injectedClass:'mixed';
     // Chrome's exceptionDetails are considered only after the exact pinned
     // fixture frame/context and official injected.js scriptId match. Numeric
     // coordinates index that PUBLIC bundled asset, not any user script.
     // Malformed/huge sites fail closed; distinct sites never yield a
     // misleading single-site diagnosis. This is NOT execution/GM proof.
     const line=(event as {lineNumber?:unknown}).lineNumber;
     const column=(event as {columnNumber?:unknown}).columnNumber;
     const site=typeof line==='number'&&Number.isSafeInteger(line)&&
      line>=0&&line<=100000&&typeof column==='number'&&
      Number.isSafeInteger(column)&&column>=0&&column<=10000000
      ?'L'+line+':C'+column:'unknown';
     injectedSite=injectedSite==='not-observed'?site:
      injectedSite===site?injectedSite:'multiple';
     // Only an exception that CDP attributes to the exact official
     // injected.js asset in the pinned disposable frame may be classified.
     // Compare fixed upstream source's data.info nullish-failure prefix
     // locally; neither the description nor any tail/stack is exported.
     const description=exception&&typeof exception==='object'&&!Array.isArray(exception)
      ?(exception as {description?:unknown}).description:undefined;
     const matchesFixedPrefix=(prefixes:readonly string[]):boolean=>
      next==='TypeError'&&typeof description==='string'&&description.length<=4096&&
      prefixes.some(prefix=>description===prefix||
       description.startsWith(prefix+'\\n')||description.startsWith(prefix+'\n'));
     const missingData=matchesFixedPrefix([
      "TypeError: Cannot read properties of undefined (reading 'info')",
      "TypeError: Cannot read properties of null (reading 'info')",
     ]);
     const missingAddListener=matchesFixedPrefix([
      "TypeError: Cannot read properties of undefined (reading 'addListener')",
      "TypeError: Cannot read properties of null (reading 'addListener')",
     ]);
     const nextSignature:typeof injectedSignature=next!=='TypeError'?'unknown':
      missingData?'missing-injection-data-info':
      missingAddListener?'missing-runtime-onmessage-addlistener':'other-type-error';
     injectedSignature=injectedSignature==='not-observed'?nextSignature:
      injectedSignature===nextSignature?injectedSignature:'mixed';
    }
   }else unattributed=true;
  },
  injectedExceptionClass():string{return injectedClass;},
  injectedFailureSignature():string{return injectedSignature;},
  injectedFailureSite():string{return injectedSite;},
  snapshot():Readonly<{
   injectedWebExceptionObserved:boolean;
   injectedExceptionObserved:boolean;
   unattributedExceptionObserved:boolean;
  }>{
   return Object.freeze({
    injectedWebExceptionObserved:web,injectedExceptionObserved:injected,
    unattributedExceptionObserved:unattributed,
   });
  },
 });
}
