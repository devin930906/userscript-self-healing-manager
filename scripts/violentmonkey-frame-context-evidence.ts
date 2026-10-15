/**
 * RG-05 TEST ONLY. Observe LIVE, bounded Runtime.executionContextCreated IDs
 * in the pinned isolated loopback frame; remove destroyed/cleared contexts.
 * Never retain extension origins, script names, private URLs or raw events.
 * Context presence does NOT imply script execution or GM V4 success.
 */
export function createIsolatedFixtureFrameContextEvidence(frameId:string){
 if(typeof frameId!=='string'||frameId.length===0||frameId.length>256)
  throw new Error('Invalid isolated fixture frame identity');
 // Context IDs are process/document-local, never stable after Page.reload.
 // Preserve only the fixed default/isolated bit, not context metadata.
 const contexts=new Map<number,boolean>();
 return {
  observe(method:string,params:unknown):void{
   if(method==='Runtime.executionContextsCleared'){
    contexts.clear();return;
   }
   if(method==='Runtime.executionContextDestroyed'){
    const id=(params as {executionContextId?:unknown}|null)?.executionContextId;
    if(Number.isSafeInteger(id))contexts.delete(id as number);
    return;
   }
   if(method!=='Runtime.executionContextCreated'||!params||
      typeof params!=='object'||Array.isArray(params))return;
   const context=(params as {context?:unknown}).context;
   if(!context||typeof context!=='object'||Array.isArray(context))return;
   const value=context as {id?:unknown;auxData?:unknown};
   const aux=value.auxData;
   if(!aux||typeof aux!=='object'||Array.isArray(aux))return;
   const {frameId:id,isDefault}=aux as {frameId?:unknown;isDefault?:unknown};
   if(id!==frameId||typeof isDefault!=='boolean'||
      !Number.isSafeInteger(value.id)||(value.id as number)<1)return;
   const contextId=value.id as number;
   if(contexts.size>=8&&!contexts.has(contextId))return;
   contexts.set(contextId,isDefault);
  },
  snapshot():{defaultContextObserved:boolean;isolatedContextObserved:boolean}{
   let defaultContextObserved=false,isolatedContextObserved=false;
   for(const isDefault of contexts.values()){
    if(isDefault)defaultContextObserved=true;
    else isolatedContextObserved=true;
   }
   return {defaultContextObserved,isolatedContextObserved};
  },
 };
}
