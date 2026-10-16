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
  try{
   const runtime=typeof chrome==='object'?chrome.runtime:null;
   const send=typeof runtime?.sendMessage==='function';
   const onMessage=typeof runtime?.onMessage?.addListener==='function';
   state=send?(onMessage?'send-onmessage':'send-only'):
    onMessage?'onmessage-only':'none';
  }catch{state='unavailable';}
  root.setAttribute('data-usshm-rg05-direct-control',state);
 })();`;
 return `(async()=>{
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
    world:'USER_SCRIPT',runAt:'document_start',allFrames:false}]);
   const check=await api.getScripts({ids:[${JSON.stringify(DIRECT_CONTROL_ID)}]});
   return Array.isArray(check)&&check.length===1&&
    check[0]?.id===${JSON.stringify(DIRECT_CONTROL_ID)}&&
    check[0]?.world==='USER_SCRIPT'&&
    Array.isArray(check[0]?.matches)&&check[0].matches.length===1&&
    check[0].matches[0]===${JSON.stringify(match)}
     ?'registered':'unavailable';
  }catch{return 'unavailable';}
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
