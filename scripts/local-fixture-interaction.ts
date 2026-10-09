import type {ChromeTarget} from '../packages/cdp-client/src/index.ts';
import {validateCdpPageSocket} from '../packages/cdp-client/src/endpoint.ts';
import {assertStablePageDocument,confirmPageIdentity,type ConfirmedPageIdentity} from '../packages/cdp-client/src/page-identity.ts';
import type {SocketLike} from '../packages/cdp-client/src/snapshot.ts';

export interface SyntheticFixtureInteractionResult {
 readonly validationLevel:'synthetic-fixture-interaction';
 readonly observed:boolean;
 readonly productionEligible:false;
}

/**
 * TEST-ONLY. Never import into Electron, expose via IPC, or aim at a user's
 * website. Sends a click ONLY to a fixed button in an isolated 127.0.0.1
 * fixture page; no arbitrary selector or script evaluation is accepted.
 * This is a synthetic V2 harness, NOT verification of a real userscript.
 */
export async function runIsolatedFixtureInteraction({approved,target,fixtureUrl,
 confirm=confirmPageIdentity,socketFactory,timeoutMs=4000}:{
 approved:boolean;
 target:ChromeTarget;fixtureUrl:string;
 confirm?:(target:ChromeTarget)=>Promise<ConfirmedPageIdentity>;
 socketFactory?:(url:string)=>SocketLike;
 timeoutMs?:number;
}):Promise<SyntheticFixtureInteractionResult>{
 if(approved!==true)throw new Error('Explicit fixture interaction approval required');
 let url:URL;
 try{url=new URL(fixtureUrl);}catch{throw new Error('Invalid local fixture URL');}
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
    url.pathname!=='/fixture'||url.search||url.hash||url.username||url.password||
    !target||target.type!=='page'||target.url!==fixtureUrl||!target.id)
  throw new Error('Refusing non-local or mismatched synthetic fixture target');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)
  throw new Error('Invalid fixture interaction timeout');
 const endpoint=validateCdpPageSocket(target);
 const before=await confirm(target);
 if(before.targetId!==target.id||before.confirmedUrl!==fixtureUrl||
    !before.frameId||!before.loaderId)
  throw new Error('Synthetic fixture document identity not verified');

 const socket=(socketFactory??((url:string)=>new WebSocket(url) as unknown as SocketLike))(endpoint);
 const observed=await new Promise<boolean>((resolve,reject)=>{
  let done=false,serial=0,waiting='',root=0,node=0,x=0,y=0,attributesRead=0,postClick=false;
  const handlers:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[];
  const finish=(error?:Error,passed=false)=>{
   if(done)return;done=true;clearTimeout(timer);
   for(const [name,handler] of handlers)socket.removeEventListener(name,handler);
   try{socket.close();}catch{}
   if(error)reject(error);else resolve(passed);
  };
  const send=(method:string,params:Record<string,unknown>={})=>{
   waiting=method;
   socket.send(JSON.stringify({id:++serial,method,params}));
  };
  const readAttrs=(raw:unknown):Map<string,string>=>{
   if(!Array.isArray(raw)||raw.length>80||raw.length%2!==0)
    throw new Error('Invalid fixture element attributes');
   const attrs=new Map<string,string>();
   for(let i=0;i<raw.length;i+=2){
    if(typeof raw[i]!=='string'||typeof raw[i+1]!=='string'||
       String(raw[i]).length>128||String(raw[i+1]).length>1000)
     throw new Error('Invalid fixture element attribute data');
    const key=(raw[i] as string).toLowerCase();
    if(attrs.has(key))throw new Error('Duplicate fixture element attribute');
    attrs.set(key,raw[i+1] as string);
   }
   return attrs;
  };
  const onOpen=()=>{try{send('DOM.getDocument',{depth:0,pierce:false});}catch(error){finish(error as Error);}};
  const onMessage=(event:{data:unknown})=>{
   try{
    if(typeof event.data!=='string'||event.data.length>128000)
     throw new Error('Invalid fixture CDP response size');
    const m:unknown=JSON.parse(event.data);
    if(!m||typeof m!=='object'||Array.isArray(m))
     throw new Error('Invalid synthetic fixture CDP response envelope');
    const response=m as {id?:unknown;error?:unknown;result?:unknown};
    if(response.id!==serial||done)return;
    if(response.error)throw new Error('Fixture CDP command rejected: '+waiting);
    if(!response.result||typeof response.result!=='object'||Array.isArray(response.result))
     throw new Error('Invalid synthetic fixture CDP result');
    const m=response as {result:any};
    switch(waiting){
     case 'DOM.getDocument':
      root=m.result?.root?.nodeId;
      if(!Number.isSafeInteger(root)||root<1)throw new Error('Invalid synthetic document root');
      send('DOM.querySelectorAll',{nodeId:root,selector:'#fixture-safe-click'});
      break;
     case 'DOM.querySelectorAll':{
      const matches=m.result?.nodeIds;
      if(!Array.isArray(matches)||matches.length!==1||
         !Number.isSafeInteger(matches[0])||matches[0]<1)
       throw new Error('Synthetic fixture button must match exactly one valid node');
      if(postClick&&matches[0]!==node)
       throw new Error('Synthetic fixture target changed after click');
      node=matches[0];
      send('DOM.getAttributes',{nodeId:node});
      break;
     }
     case 'DOM.getAttributes':{
      const attrs=readAttrs(m.result?.attributes);
      if(attributesRead++===0){
       if(attrs.get('id')!=='fixture-safe-click'||attrs.get('type')!=='button'||attrs.has('disabled')||attrs.has('inert')||!['', 'false'].includes(attrs.get('aria-hidden')?.toLowerCase()??'')||
          !['', 'false'].includes(attrs.get('aria-disabled')?.toLowerCase()??''))
        throw new Error('Synthetic fixture button disabled, blocked or replaced');
       if(attrs.has('data-usshm-v2-fixture'))
        throw new Error('Preexisting synthetic success marker cannot establish click causality');
       send('DOM.getBoxModel',{nodeId:node});
      }else finish(undefined,attrs.get('id')==='fixture-safe-click'&&attrs.get('type')==='button'&&
        !attrs.has('disabled')&&!attrs.has('inert')&&['', 'false'].includes(attrs.get('aria-hidden')?.toLowerCase()??'')&&['', 'false'].includes(attrs.get('aria-disabled')?.toLowerCase()??'')&&
        attrs.get('data-usshm-v2-fixture')==='yes');
      break;
     }
     case 'DOM.getBoxModel':{
      const quad=m.result?.model?.content;
      if(!Array.isArray(quad)||quad.length!==8||
         quad.some((value:unknown)=>typeof value!=='number'||!Number.isFinite(value)||value<0||value>5000))
       throw new Error('Invalid synthetic fixture button bounds');
      const xs=[quad[0],quad[2],quad[4],quad[6]] as number[];
      const ys=[quad[1],quad[3],quad[5],quad[7]] as number[];
      if(Math.max(...xs)-Math.min(...xs)<2||Math.max(...ys)-Math.min(...ys)<2)
       throw new Error('Invisible synthetic fixture button');
      x=xs.reduce((a,b)=>a+b,0)/4;y=ys.reduce((a,b)=>a+b,0)/4;
      send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      break;
     }
     case 'Input.dispatchMouseEvent':
      if(attributesRead===1){
       // First Input response is press; second is release. Never navigate.
       attributesRead=2;
       send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
      }else{
       postClick=true;
       send('DOM.querySelectorAll',{nodeId:root,selector:'#fixture-safe-click'});
      }
      break;
     default:throw new Error('Unexpected synthetic fixture CDP response');
    }
   }catch(error){finish(error instanceof Error?error:new Error('Invalid fixture CDP message'));}
  };
  const onError=()=>finish(new Error('Synthetic fixture CDP socket error'));
  const onClose=()=>finish(new Error('Synthetic fixture CDP socket closed'));
  handlers.push(['open',onOpen],['message',onMessage],['error',onError],['close',onClose]);
  const timer=setTimeout(()=>finish(new Error('Synthetic fixture interaction timeout')),timeoutMs);
  for(const [name,handler] of handlers)socket.addEventListener(name,handler);
 });
 const after=await confirm(target);
 assertStablePageDocument(before,after);
 return {validationLevel:'synthetic-fixture-interaction',observed,productionEligible:false};
}
