import type {ConfirmedPageIdentity} from '../packages/cdp-client/src/page-identity.ts';

const TRANSIENT_STARTUP_FRAME_ERRORS=new Set([
 'Invalid CDP frame tree URL',
 'Invalid main-frame document identity token',
]);

/**
 * TEST-ONLY: newly opened loopback GM fixture pages can appear in /json/list
 * before Page.getFrameTree has a URL and document loader. Retry only these
 * two transient pre-document conditions; NEVER retry a changed URL, unknown
 * transport failure, or navigation/identity mismatch.
 *
 * This helper cannot promote product V4; production page evidence continues
 * to use strict one-shot document identity fences.
 */
export async function waitForPinnedFixtureFrame({
 expectedUrl,inspect,hasExited,pause,maxAttempts=16,
}:{
 expectedUrl:string;
 inspect:()=>Promise<ConfirmedPageIdentity>;
 hasExited:()=>boolean;
 pause:()=>Promise<void>;
 maxAttempts?:number;
}):Promise<ConfirmedPageIdentity>{
 let parsed:URL;
 try{parsed=new URL(expectedUrl);}catch{throw new Error('Invalid isolated loopback fixture URL');}
 if(typeof expectedUrl!=='string'||expectedUrl.length>160||
    parsed.href!==expectedUrl||parsed.protocol!=='http:'||
    parsed.hostname!=='127.0.0.1'||!parsed.port||
    parsed.username||parsed.password||parsed.search||parsed.hash||
    parsed.pathname!=='/fixture')
  throw new Error('Invalid isolated loopback fixture URL');
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>20||
    typeof inspect!=='function'||typeof hasExited!=='function'||typeof pause!=='function')
  throw new Error('Invalid isolated fixture frame readiness budget');
 for(let attempt=0;attempt<maxAttempts;attempt++){
  if(hasExited())throw new Error('Isolated CFT exited before fixture frame readiness');
  try{
   const identity=await inspect();
   if(hasExited())throw new Error('Isolated CFT exited before fixture frame readiness');
   if(!identity||identity.confirmedUrl!==expectedUrl||
      typeof identity.targetId!=='string'||!identity.targetId||
      typeof identity.frameId!=='string'||!identity.frameId||identity.frameId.length>256||
      typeof identity.loaderId!=='string'||!identity.loaderId||identity.loaderId.length>256)
    throw new Error('Isolated fixture frame identity mismatch');
   return identity;
  }catch(error){
   if(!(error instanceof Error)||!TRANSIENT_STARTUP_FRAME_ERRORS.has(error.message))
    throw new Error('Isolated fixture frame identity validation failed');
  }
  if(attempt+1===maxAttempts)break;
  if(hasExited())throw new Error('Isolated CFT exited before fixture frame readiness');
  try{await pause();}catch{throw new Error('Isolated fixture frame readiness wait failed');}
 }
 throw new Error('Isolated fixture document did not become ready');
}
