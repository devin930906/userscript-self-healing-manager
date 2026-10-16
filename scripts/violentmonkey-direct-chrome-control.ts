/**
 * RG-05 isolated Chrome 155 differential, TEST-ONLY.
 * Registers ONE fixed direct chrome.userScripts entry in the pinned official
 * manager's disposable profile, only after actual cold-start GM failures.
 * Neither registration nor DOM markers are proof of official manager V4.
 */
export const DIRECT_CONTROL_ID='usshm-rg05-disposable-direct-control-v1';
const EXTENSION_ID='jinjaccalgkegednnccohejagnlnfdag';
const OPTIONS_URL='chrome-extension://'+EXTENSION_ID+'/options/index.html#settings';

function requireDirectControlUrl(input:string):string{
 let url:URL;
 try{url=new URL(input);}catch{throw new Error('Invalid isolated direct Chrome control URL');}
 if(typeof input!=='string'||input.length>160||url.href!==input||
    url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
    url.pathname!=='/rg05-direct-control'||url.username||url.password||
    url.search||url.hash)
  throw new Error('Invalid isolated direct Chrome control URL');
 return input;
}

/**
 * Only our own, fixed source can execute on the exact fresh loopback page.
 * The direct userScript controls the browser API path independently of VM's
 * internal GetInjected and content bridge. This is a *post-blocker* experiment.
 */
export function buildDirectChromeUserScriptRegistration(controlUrl:string):string{
 const url=requireDirectControlUrl(controlUrl);
 // Chrome match patterns do not include a dynamic localhost port. The script
 // itself enforces the FULL pinned URL before touching the DOM.
 const match='http://127.0.0.1/rg05-direct-control';
 const script=`(()=>{
  if(location.href!==${JSON.stringify(url)})return;
  const root=document.documentElement;
  if(!root)return;
  let state='none';
  let runtime;
  try{
   runtime=typeof chrome==='object'?chrome.runtime:null;
   const send=typeof runtime?.sendMessage==='function';
   const onMessage=typeof runtime?.onMessage?.addListener==='function';
   state=send?(onMessage?'send-onmessage':'send-only'):
    onMessage?'onmessage-only':'none';
  }catch{state='unavailable';}
  root.setAttribute('data-usshm-rg05-direct-control',state);
  // Dedicated Chrome USER_SCRIPT messaging must produce a real reply;
  // ordinary onMessage API presence is not a positive roundtrip result.
  try{
   const request=runtime?.sendMessage?.({kind:'usshm-rg05-direct-v1'});
   if(request&&typeof request.then==='function')
    Promise.resolve(request).then(answer=>{
     if(answer&&answer.kind==='usshm-rg05-direct-v1-response')
      root.setAttribute('data-usshm-rg05-direct-roundtrip','verified');
    }).catch(()=>{});
  }catch{}
 })();`;
 return `(async()=>{
  let created=false;
  try{
   if(location.href!==${JSON.stringify(OPTIONS_URL)}||
      chrome.runtime?.id!==${JSON.stringify(EXTENSION_ID)})return 'unavailable';
   const api=chrome.userScripts;
   if(typeof api?.getScripts!=='function'||typeof api.register!=='function')
    return 'unavailable';
   const prior=await api.getScripts({ids:[${JSON.stringify(DIRECT_CONTROL_ID)}]});
   if(!Array.isArray(prior)||prior.length!==0)return 'unavailable';
   await api.register([{id:${JSON.stringify(DIRECT_CONTROL_ID)},
    matches:[${JSON.stringify(match)}],js:[{code:${JSON.stringify(script)}}],
    world:'USER_SCRIPT',runAt:'document_idle',allFrames:false}]);
   created=true;
   const check=await api.getScripts({ids:[${JSON.stringify(DIRECT_CONTROL_ID)}]});
   // The fixed ID and match alone cannot prove our own code, stage or frame scope.
   const valid=Array.isArray(check)&&check.length===1&&
    check[0]?.id===${JSON.stringify(DIRECT_CONTROL_ID)}&&
    check[0]?.world==='USER_SCRIPT'&&
    check[0]?.runAt==='document_idle'&&
    check[0]?.allFrames!==true&&
    Array.isArray(check[0]?.js)&&check[0].js.length===1&&
    check[0].js[0]?.code===${JSON.stringify(script)}&&
    Array.isArray(check[0]?.matches)&&check[0].matches.length===1&&
    check[0].matches[0]===${JSON.stringify(match)};
   if(valid)return 'registered';
   try{await api.unregister({ids:[${JSON.stringify(DIRECT_CONTROL_ID)}]});}catch{}
   return 'unavailable';
  }catch{
   if(created){
    try{await chrome.userScripts?.unregister({ids:[${JSON.stringify(DIRECT_CONTROL_ID)}]});}catch{}
   }
   return 'unavailable';
  }
 })()`;
}

/** Remove only the uniquely named disposable direct-control script. */
export function buildDirectChromeUserScriptRemoval():string{
 return `(async()=>{
  try{
   if(location.href!==${JSON.stringify(OPTIONS_URL)}||
      chrome.runtime?.id!==${JSON.stringify(EXTENSION_ID)})return 'unavailable';
   const api=chrome.userScripts;
   if(typeof api?.unregister!=='function'||typeof api.getScripts!=='function')
    return 'unavailable';
   await api.unregister({ids:[${JSON.stringify(DIRECT_CONTROL_ID)}]});
   const after=await api.getScripts({ids:[${JSON.stringify(DIRECT_CONTROL_ID)}]});
   return Array.isArray(after)&&after.length===0?'removed':'unavailable';
  }catch{return 'unavailable';}
 })()`;
}

/**
 * RG-05 post-blocker only: attach one fixed receiver in the isolated pinned
 * manager options page. Do not configureWorld(), call GetInjected, read
 * unrelated messages, or register any persistent official-manager handler.
 * User-script messages use the dedicated onUserScriptMessage event, NOT the
 * ordinary onMessage event. The receiver only answers a synthetic exact-URL
 * sender from our disposable control document.
 */
export function buildDirectChromeUserScriptListenerInstallation(controlUrl:string):string{
 const url=requireDirectControlUrl(controlUrl);
 return `(()=>{
  try{
   if(location.href!==${JSON.stringify(OPTIONS_URL)}||
      chrome.runtime?.id!==${JSON.stringify(EXTENSION_ID)})return 'unavailable';
   const runtime=chrome.runtime;
   const channel=runtime.onUserScriptMessage;
   if(typeof channel?.addListener!=='function'||typeof channel?.removeListener!=='function')
    return 'unavailable';
   const key='__usshm_rg05_direct_message_receiver_v1__';
   if(Object.getOwnPropertyDescriptor(window,key))return 'unavailable';
   const listener=(message,sender,sendResponse)=>{
    try{
     if(!message||typeof message!=='object'||Array.isArray(message)||
        Object.getOwnPropertyDescriptor(message,'kind')?.value!=='usshm-rg05-direct-v1'||
        !sender||sender.id!==${JSON.stringify(EXTENSION_ID)}||
        sender.url!==${JSON.stringify(url)}||
        typeof sendResponse!=='function')return;
     sendResponse({kind:'usshm-rg05-direct-v1-response'});
     return true;
    }catch{return;}
   };
   try{
    channel.addListener(listener);
    Object.defineProperty(window,key,{value:listener,configurable:true});
    return 'attached';
   }catch{
    try{channel.removeListener(listener);}catch{}
    try{delete window[key];}catch{}
    return 'unavailable';
   }
  }catch{return 'unavailable';}
 })()`;
}

/** Remove only the listener installed by this exact disposable test. */
export function buildDirectChromeUserScriptListenerRemoval():string{
 return `(()=>{
  try{
   if(location.href!==${JSON.stringify(OPTIONS_URL)}||
      chrome.runtime?.id!==${JSON.stringify(EXTENSION_ID)})return 'unavailable';
   const channel=chrome.runtime.onUserScriptMessage;
   const key='__usshm_rg05_direct_message_receiver_v1__';
   const listener=Object.getOwnPropertyDescriptor(window,key)?.value;
   if(typeof listener!=='function'||typeof channel?.removeListener!=='function')
    return 'unavailable';
   channel.removeListener(listener);
   if(!delete window[key])return 'unavailable';
   return 'removed';
  }catch{return 'unavailable';}
 })()`;
}
