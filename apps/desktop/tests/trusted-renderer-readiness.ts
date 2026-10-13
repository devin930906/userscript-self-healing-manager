/**
 * Test-only trusted Electron renderer readiness gate.
 * This never grants access and never changes production Electron configuration.
 */
export interface TrustedRendererState {
 readonly href:string;
 readonly readyState:string;
 readonly topLevel:boolean;
 readonly hasGetAppInfo:boolean;
 readonly hasGenericInvoke:boolean;
 readonly hasNode:boolean;
 readonly hasRawIpc:boolean;
}
export async function waitForTrustedRendererReady(
 probe:()=>Promise<TrustedRendererState|null>,
 options:{expectedUrl:string;attempts:number;pause:()=>Promise<void>;assertAlive:()=>void}
):Promise<void>{
 if(typeof probe!=='function'||!options||typeof options!=='object'||
    typeof options.pause!=='function'||typeof options.assertAlive!=='function'||
    !Number.isSafeInteger(options.attempts)||options.attempts<1||options.attempts>100||
    typeof options.expectedUrl!=='string'||!options.expectedUrl.startsWith('file://'))
  throw new Error('Unsafe trusted renderer readiness options');
 let last:'no-context'|'loading'|'missing-preload'='no-context';
 for(let attempt=0;attempt<options.attempts;attempt++){
  options.assertAlive();
  const state=await probe();
  options.assertAlive();
  if(state!==null){
   // Never wait away a security violation or a navigation into a different
   // frame/document. Only transient incomplete preload or CDP context is polled.
   // CDP response shapes can be incomplete after a context reset. Never
   // interpret an untyped/malformed probe as a safe transient preload delay.
   if(typeof state.href!=='string'||
      !['loading','interactive','complete'].includes(state.readyState)||
      typeof state.topLevel!=='boolean'||
      typeof state.hasGetAppInfo!=='boolean'||
      typeof state.hasGenericInvoke!=='boolean'||
      typeof state.hasNode!=='boolean'||
      typeof state.hasRawIpc!=='boolean')
    throw new Error('Malformed trusted renderer readiness probe');
   if(state.href!==options.expectedUrl||!state.topLevel){
    // Only fixed diagnostic labels: never interpolate CDP page URLs, paths,
    // query parameters, DOM contents or live renderer error messages.
    const reason=!state.topLevel?'subframe':
     state.href.startsWith('file://')?'different-file-document':'non-file-document';
    const preload=state.hasGetAppInfo?'present':'absent';
    throw new Error('Untrusted renderer document or frame during readiness check'+
     ' (reason='+reason+', ready='+state.readyState+', preload='+preload+')');
   }
   if(state.hasNode||state.hasRawIpc||state.hasGenericInvoke)
    throw new Error('Unsafe trusted renderer security bridge exposure');
   if((state.readyState==='interactive'||state.readyState==='complete')&&state.hasGetAppInfo)
    return;
   last=state.readyState==='loading'?'loading':'missing-preload';
  }
  if(attempt+1<options.attempts)await options.pause();
 }
 throw new Error('Trusted renderer preload not ready within bounded probes (last='+last+')');
}
