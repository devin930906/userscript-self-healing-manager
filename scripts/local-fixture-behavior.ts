import type {ChromeTarget} from '../packages/cdp-client/src/index.ts';
import {validateCdpPageSocket} from '../packages/cdp-client/src/endpoint.ts';
import {confirmPageIdentity,type ConfirmedPageIdentity} from '../packages/cdp-client/src/page-identity.ts';
import type {SocketLike} from '../packages/cdp-client/src/snapshot.ts';

/**
 * Exact source allowlist for disposable smoke fixtures ONLY. A familiar
 * @name header is not an execution authorization: it can be prepended to
 * arbitrary malicious JavaScript. All permitted variants below are generated
 * exclusively from the fixed fixture scripts used in this test suite.
 */
const FIXTURE_HEADER='// ==UserScript==\n// @name Local CDP Smoke\n// @match http://127.0.0.1/*\n// ==/UserScript==\n';
const FIXTURE_TAIL='if(actionButton&&targetPane){actionButton.setAttribute("data-usshm-functional","pass");targetPane.setAttribute("data-usshm-functional","pass");}\n'
 +'if(!document.getElementById("usshm-nested-frame")){const frame=document.createElement("iframe");frame.id="usshm-nested-frame";frame.srcdoc="<button id=iframe-only>Nested DOM</button>";document.body.append(frame);}\n';
const SYNTHETIC_SOURCE_ALLOWLIST=new Set<string>([
 FIXTURE_HEADER+'const action=document.querySelector("#old-heal-button");\n'
  +'if(action)action.setAttribute("data-usshm-functional","pass");\n',
 ...['#old-heal-button','#heal-button'].flatMap(button=>
  ['.old-target-pane','.target-pane'].map(pane=>
   FIXTURE_HEADER+'const actionButton=document.querySelector("'+button
    +'");const targetPane=document.querySelector("'+pane+'");\n'+FIXTURE_TAIL)),
]);

/**
 * TEST-ONLY: execute the explicitly named *synthetic* userscript on the
 * disposable localhost fixture. This module must never be imported by the
 * Electron app or accept an arbitrary user-supplied script.
 *
 * Production CDP operations remain read-only and do NOT use Runtime.evaluate.
 * This validates plain browser DOM side effects, NOT Tampermonkey/GM_* behavior.
 */
export async function runIsolatedFixtureBehavior({target,fixtureUrl,source,confirm=confirmPageIdentity,socketFactory,timeoutMs=4000}:{
 target:ChromeTarget;fixtureUrl:string;source:string;
 confirm?:(target:ChromeTarget)=>Promise<ConfirmedPageIdentity>;
 socketFactory?:(url:string)=>SocketLike;timeoutMs?:number;
}):Promise<boolean>{
 let url:URL;
 try{url=new URL(fixtureUrl);}catch{throw new Error('Invalid fixture URL');}
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
    url.pathname!=='/fixture'||url.search||url.hash||target.url!==fixtureUrl)
  throw new Error('Refusing non-local or mismatched fixture target');
 if(typeof source!=='string'||source.length>12_000||
    !SYNTHETIC_SOURCE_ALLOWLIST.has(source))
  throw new Error('Refusing source outside the fixed synthetic fixture allowlist');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10_000)
  throw new Error('Invalid local fixture evaluation timeout');
 const endpoint=validateCdpPageSocket(target);
 const before=await confirm(target);
 if(before.targetId!==target.id||before.confirmedUrl!==fixtureUrl||
    typeof before.frameId!=='string'||!before.frameId||before.frameId.length>256||
    typeof before.loaderId!=='string'||!before.loaderId||before.loaderId.length>256)
  throw new Error('Fixture main-frame document identity unverified before evaluation');

 // The fixture's two known nodes form a tiny, deterministic observable effect.
 // Reset the markers each time so an old successful run cannot mask a failure.
 const expression=`(()=>{
  const __fixtureButton=document.getElementById('heal-button');
  const __fixturePane=document.querySelector('.target-pane');
  if(!__fixtureButton||!__fixturePane)return false;
  __fixtureButton.removeAttribute('data-usshm-functional');
  __fixturePane.removeAttribute('data-usshm-functional');
  ${source}
  return __fixtureButton.getAttribute('data-usshm-functional')==='pass' &&
         __fixturePane.getAttribute('data-usshm-functional')==='pass';
 })()`;
 const socket=(socketFactory??((url:string)=>new WebSocket(url) as unknown as SocketLike))(endpoint);
 const worked=await new Promise<boolean>((resolve,reject)=>{
  let done=false;
  const complete=(error?:Error,value?:boolean)=>{
   if(done)return;done=true;clearTimeout(timer);
   for(const [name,listener] of handlers)socket.removeEventListener(name,listener);
   try{socket.close();}catch{}
   if(error)reject(error);else resolve(value===true);
  };
  const onOpen=()=>{
   try{socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{
    expression,returnByValue:true,awaitPromise:false,includeCommandLineAPI:false,
    userGesture:false,silent:true,
   }}));}catch(error){complete(error instanceof Error?error:new Error('Fixture CDP send failed'));}
  };
  const onMessage=(event:{data:unknown})=>{
   try{
    if(typeof event.data!=='string'||event.data.length>256_000)
     throw new Error('Invalid fixture CDP response');
    const response=JSON.parse(event.data);
    if(response.id!==1)return;
    if(response.error||response.result?.exceptionDetails)
     throw new Error('Synthetic userscript fixture execution exception');
    if(response.result?.result?.type!=='boolean'||typeof response.result.result.value!=='boolean')
     throw new Error('Unexpected functional fixture response type');
    complete(undefined,response.result.result.value);
   }catch(error){complete(error instanceof Error?error:new Error('Invalid fixture evaluation response'));}
  };
  const onError=()=>complete(new Error('Fixture CDP socket error'));
  const onClose=()=>complete(new Error('Fixture CDP socket closed early'));
  const handlers:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[
   ['open',onOpen],['message',onMessage],['error',onError],['close',onClose],
  ];
  const timer=setTimeout(()=>complete(new Error('Fixture CDP evaluation timeout')),timeoutMs);
  for(const [name,listener] of handlers)socket.addEventListener(name,listener);
 });
 const after=await confirm(target);
 // A synthetic script intentionally creates a child iframe; comparing total
 // subframe counts would reject a legitimate fixture effect. Pin only the
 // top-frame document + loader identity, which must never change during eval.
 if(after.targetId!==target.id||after.confirmedUrl!==fixtureUrl||
    after.frameId!==before.frameId||after.loaderId!==before.loaderId)
  throw new Error('Fixture main-frame document/loader identity changed during evaluation');
 return worked;
}
