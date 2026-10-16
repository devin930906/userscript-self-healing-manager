/**
 * RG-05 TEST ONLY. Observe LIVE, bounded Runtime.executionContextCreated IDs
 * in the pinned isolated loopback frame; remove destroyed/cleared contexts.
 * Never retain extension origins, script names, private URLs or raw events.
 * Context presence does NOT imply script execution or GM V4 success.
 */
/** Only bounded, own data fields from decoded CDP JSON can be evidence.
 * Accessors, inherited metadata and hostile proxy traps are not receipts. */
function ownData(value:unknown,key:string):unknown{
 if(!value||typeof value!=='object')return undefined;
 try{
  if(Array.isArray(value))return undefined;
  const entry=Object.getOwnPropertyDescriptor(value,key);
  return entry&&Object.hasOwn(entry,'value')?entry.value:undefined;
 }catch{return undefined;}
}

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
    const id=ownData(params,'executionContextId');
    if(Number.isSafeInteger(id))contexts.delete(id as number);
    return;
   }
   if(method!=='Runtime.executionContextCreated')return;
   const context=ownData(params,'context');
   const aux=ownData(context,'auxData');
   const id=ownData(aux,'frameId');
   const isDefault=ownData(aux,'isDefault');
   const contextId=ownData(context,'id');
   if(id!==frameId||typeof isDefault!=='boolean'||
      !Number.isSafeInteger(contextId)||(contextId as number)<1)return;
   if(contexts.size>=8&&!contexts.has(contextId as number))return;
   contexts.set(contextId as number,isDefault);
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
