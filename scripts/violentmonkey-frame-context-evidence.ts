/**
 * RG-05 TEST ONLY. Record bounded Runtime.executionContextCreated data from
 * the exact isolated loopback frame. Never retain extension origins, script
 * names, private URL strings or the raw event. World presence != GM success.
 */
export function createIsolatedFixtureFrameContextEvidence(frameId:string){
 if(typeof frameId!=='string'||frameId.length===0||frameId.length>256)
  throw new Error('Invalid isolated fixture frame identity');
 let defaultContextObserved=false,isolatedContextObserved=false;
 return {
  observe(method:string,params:unknown):void{
   if(method!=='Runtime.executionContextCreated'||!params||
      typeof params!=='object'||Array.isArray(params))return;
   const context=(params as {context?:unknown}).context;
   if(!context||typeof context!=='object'||Array.isArray(context))return;
   const aux=(context as {auxData?:unknown}).auxData;
   if(!aux||typeof aux!=='object'||Array.isArray(aux))return;
   const {frameId:id,isDefault}=aux as {frameId?:unknown;isDefault?:unknown};
   if(id!==frameId||typeof isDefault!=='boolean')return;
   if(isDefault)defaultContextObserved=true;
   else isolatedContextObserved=true;
  },
  snapshot():{defaultContextObserved:boolean;isolatedContextObserved:boolean}{
   return {defaultContextObserved,isolatedContextObserved};
  },
 };
}
