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
