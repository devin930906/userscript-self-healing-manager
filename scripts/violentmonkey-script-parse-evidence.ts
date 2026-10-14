/**
 * RG-05 disposable CFT155/official Violentmonkey diagnostic only.
 * CDP Debugger.scriptParsed is parse visibility, NOT userscript execution,
 * completion or GM entitlement. Inspect only the pinned official extension's
 * two known registered injector assets for the already-verified fixture frame.
 * Never retain or export script URL, source text, CDP script IDs, or contexts.
 */
const OFFICIAL_EXTENSION_ID='jinjaccalgkegednnccohejagnlnfdag';
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
   const parsed=params as {
    scriptId?:unknown;url?:unknown;executionContextId?:unknown;
    executionContextAuxData?:unknown;
   };
   if(typeof parsed.scriptId!=='string'||!parsed.scriptId||
      !Number.isSafeInteger(parsed.executionContextId)||
      Number(parsed.executionContextId)<1||
      typeof parsed.url!=='string')return;
   const aux=parsed.executionContextAuxData;
   if(!aux||typeof aux!=='object'||Array.isArray(aux)||
      (aux as {frameId?:unknown}).frameId!==frameId)return;
   if(parsed.url===prefix+'injected-web.js')injectedWebParsed=true;
   else if(parsed.url===prefix+'injected.js')injectedParsed=true;
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
 let injectedSignature:'not-observed'|'missing-injection-data-info'|'other-type-error'|'unknown'|'mixed'='not-observed';
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
    const event=params as {
     scriptId?:unknown;url?:unknown;executionContextId?:unknown;
     executionContextAuxData?:unknown;
    };
    const aux=event.executionContextAuxData;
    if(!aux||typeof aux!=='object'||Array.isArray(aux)||
       (aux as {frameId?:unknown}).frameId!==frameId||
       typeof event.scriptId!=='string'||!event.scriptId||
       event.scriptId.length>128||!Number.isSafeInteger(event.executionContextId)||
       Number(event.executionContextId)<1||typeof event.url!=='string')return;
    const ctx=event.executionContextId as number;
    if(!contexts.has(ctx)){
     if(contexts.size>=8)return;
     contexts.add(ctx);
    }
    const kind=event.url===prefix+'injected-web.js'?'web':
     event.url===prefix+'injected.js'?'injected':null;
    if(kind&&sources.size<32)sources.set(event.scriptId,{kind,contextId:ctx});
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
     const signatures=[
      "TypeError: Cannot read properties of undefined (reading 'info')",
      "TypeError: Cannot read properties of null (reading 'info')",
     ];
     const missingData=next==='TypeError'&&typeof description==='string'&&
      description.length<=4096&&signatures.some(prefix=>
       description===prefix||description.startsWith(prefix+'\\n')||
       description.startsWith(prefix+'\n'));
     const nextSignature:typeof injectedSignature=next!=='TypeError'?'unknown':
      missingData?'missing-injection-data-info':'other-type-error';
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
