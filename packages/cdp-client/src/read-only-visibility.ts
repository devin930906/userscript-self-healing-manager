import type {ChromeTarget} from './index.ts';
import {validateCdpPageSocket} from './endpoint.ts';
import {asCss,type LiteralLocator} from './locator-probe.ts';
import type {SocketLike} from './snapshot.ts';

export type ReadOnlyVisibility='potentially-visible'|'hidden'|'missing'|'ambiguous'|'unknown';
/** Direct-element attributes only; not a full disabled or pointer-interaction proof. */
export type ReadOnlyControlBlocker='disabled-attribute'|'aria-disabled'|'readonly-attribute'|'none-detected'|'unknown';
export interface ReadOnlyVisibilityEvidence {
 readonly targetId:string;
 readonly url:string;
 readonly validationLevel:'css-box-read-only';
 readonly status:ReadOnlyVisibility;
 readonly matchCount:number|null;
 readonly pointerBlocked:boolean|null;
 readonly controlBlocker:ReadOnlyControlBlocker;
 readonly interactionVerified:false;
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
}
/**
 * A zero-match in the top document must not be shown as a definitive absence
 * when iframe/author ShadowRoot targets might exist or snapshot evidence failed.
 * Only the status is qualified; this cannot manufacture V2/V3/V4 success.
 */
export function qualifyTopDocumentVisibility(
 evidence:ReadOnlyVisibilityEvidence,subframeCount:number,authorShadowTreeNodes:number|null,
):ReadOnlyVisibilityEvidence{
 if(evidence.status!=='missing')return evidence;
 if(subframeCount===0&&authorShadowTreeNodes===0)return evidence;
 return {...evidence,status:'unknown',matchCount:null};
}
const MAX_REPLY_BYTES=300_000;
const MAX_COMPUTED_STYLES=512;
const MAX_ATTRIBUTES=256;
/** No attribute values are ever exported. Invalid, duplicate or saturated responses are unknown. */
function directControlBlocker(raw:unknown):ReadOnlyControlBlocker{
 if(!Array.isArray(raw)||raw.length>MAX_ATTRIBUTES||raw.length%2!==0)return 'unknown';
 const attr=new Map<string,string>();
 for(let i=0;i<raw.length;i+=2){
  const name=raw[i],value=raw[i+1];
  if(typeof name!=='string'||typeof value!=='string'||
    !/^[a-zA-Z_:][a-zA-Z0-9_:.-]{0,127}$/.test(name)||value.length>2048||attr.has(name.toLowerCase()))
   return 'unknown';
  attr.set(name.toLowerCase(),value);
 }
 if(attr.has('disabled'))return 'disabled-attribute';
 if(attr.has('aria-disabled')&&!['true','false'].includes(attr.get('aria-disabled')!.trim().toLowerCase()))return 'unknown';
 if(attr.get('aria-disabled')?.trim().toLowerCase()==='true')return 'aria-disabled';
 if(attr.has('readonly'))return 'readonly-attribute';
 return 'none-detected';
}
const allowStyles=new Set(['display','visibility','opacity','pointer-events']);
/**
 * Collects limited CSS/box evidence only. No JS evaluation, DOM mutation,
 * scrolling, mouse input, focus or event dispatch. "Potentially visible" is
 * NOT equivalent to clickability, ancestor visibility or V2 verification.
 */
export async function inspectReadOnlyElementVisibility(target:ChromeTarget,locator:LiteralLocator,
 options:{socketFactory?:(endpoint:string)=>SocketLike;timeoutMs?:number}={}):Promise<ReadOnlyVisibilityEvidence>{
 const css=locator&&asCss(locator);
 if(!css||locator.runtimeRequired)throw new Error('A supported static literal selector is required');
 if(css.length>1024)throw new Error('CSS selector budget exceeded');
 const endpoint=validateCdpPageSocket(target);
 const timeoutMs=options.timeoutMs??6500;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)
  throw new Error('Invalid read-only visibility timeout');
 let controlBlocker:ReadOnlyControlBlocker='unknown';
 const output=(status:ReadOnlyVisibility,matchCount:number|null,pointerBlocked:boolean|null=null):ReadOnlyVisibilityEvidence=>({
  targetId:target.id,url:target.url,validationLevel:'css-box-read-only',
  status,matchCount,pointerBlocked,controlBlocker,interactionVerified:false,
  V2:'blocked',V3:'not-configured',V4:'not-configured',
 });
 const socket=(options.socketFactory??((url:string)=>new WebSocket(url) as unknown as SocketLike))(endpoint);
 return await new Promise<ReadOnlyVisibilityEvidence>((resolve,reject)=>{
  let ended=false,nextId=0,expectedId=0,expectedMethod='';
  let nodeId=0,matchCount:number|null=null;
  let styles:Map<string,string>|null=null;

  const send=(method:string,params:Record<string,unknown>={})=>{
   expectedId=++nextId;expectedMethod=method;
   socket.send(JSON.stringify({id:expectedId,method,params}));
  };
  const finish=(error?:Error,result?:ReadOnlyVisibilityEvidence)=>{
   if(ended)return;ended=true;clearTimeout(timer);
   for(const [event,listener] of listeners)socket.removeEventListener(event,listener);
   try{socket.close();}catch{}
   if(error)reject(error);else if(result)resolve(result);
   else reject(new Error('Invalid read-only visibility result'));
  };
  const onOpen=()=>{try{send('DOM.getDocument',{depth:0,pierce:false});}catch(e){finish(e as Error);}};
  const onMessage=(event:{data:unknown})=>{
   try{
    if(typeof event.data!=='string'||event.data.length>MAX_REPLY_BYTES)
     throw new Error('CDP visibility response size exceeded');
    const m=JSON.parse(event.data);
    if(m.id!==expectedId||ended)return;
    if(m.error){
     if(expectedMethod==='DOM.getDocument')throw new Error('Cannot read CDP document root');
     if(expectedMethod==='DOM.getAttributes'){
      controlBlocker='unknown';send('CSS.enable');
     }else if(expectedMethod==='DOM.getBoxModel'){
      const hidden=styles?.get('display')==='none'||['hidden','collapse'].includes(styles?.get('visibility')??'')||
       Number(styles?.get('opacity'))===0;
      finish(undefined,output(hidden?'hidden':'unknown',matchCount));
     }else finish(undefined,output('unknown',matchCount));
     return;
    }
    switch(expectedMethod){
     case 'DOM.getDocument':{
      const root=m.result?.root?.nodeId;
      if(!Number.isSafeInteger(root)||root<1)throw new Error('Invalid CDP document root');
      send('DOM.querySelectorAll',{nodeId:root,selector:css});
      break;
     }
     case 'DOM.querySelectorAll':{
      const nodes=m.result?.nodeIds;
      if(!Array.isArray(nodes)||nodes.some((n:unknown)=>!Number.isSafeInteger(n)||Number(n)<1)){
       finish(undefined,output('unknown',null));break;
      }
      matchCount=nodes.length<=10000?nodes.length:null;
      if(nodes.length===0){finish(undefined,output('missing',0));break;}
      if(nodes.length>1){finish(undefined,output('ambiguous',matchCount));break;}
      nodeId=nodes[0];
      send('DOM.getAttributes',{nodeId});
      break;
     }
     case 'DOM.getAttributes':{
      controlBlocker=directControlBlocker(m.result?.attributes);
      send('CSS.enable');
      break;
     }
     case 'CSS.enable':{
      send('CSS.getComputedStyleForNode',{nodeId});
      break;
     }
     case 'CSS.getComputedStyleForNode':{
      const arr=m.result?.computedStyle;
      if(!Array.isArray(arr)||arr.length>MAX_COMPUTED_STYLES){
       finish(undefined,output('unknown',matchCount));break;
      }
      styles=new Map();
      for(const x of arr){
       if(!x||typeof x.name!=='string'||!allowStyles.has(x.name))continue;
       if(typeof x.value!=='string'||x.value.length>128||styles.has(x.name)){
        finish(undefined,output('unknown',matchCount));return;
       }
       styles.set(x.name,x.value.trim().toLowerCase());
      }
      const hidden=styles.get('display')==='none'||['hidden','collapse'].includes(styles.get('visibility')??'')||
       (styles.has('opacity')&&Number(styles.get('opacity'))===0);
      if(hidden){finish(undefined,output('hidden',matchCount,styles.get('pointer-events')==='none'));break;}
      send('DOM.getBoxModel',{nodeId});
      break;
     }
     case 'DOM.getBoxModel':{
      const w=m.result?.model?.width,h=m.result?.model?.height;
      const known=styles&&['display','visibility','opacity'].every(name=>styles!.has(name));
      const opacity=Number(styles?.get('opacity'));
      if(!known||!Number.isFinite(opacity)||opacity<0||opacity>1||
         !Number.isFinite(w)||!Number.isFinite(h)||w<0||h<0||w>100000||h>100000){
       finish(undefined,output('unknown',matchCount));break;
      }
      finish(undefined,output(w===0||h===0?'hidden':'potentially-visible',
       matchCount,styles!.has('pointer-events')?styles!.get('pointer-events')==='none':null));
      break;
     }
     default:throw new Error('Unexpected read-only CDP command');
    }
   }catch(error){finish(error instanceof Error?error:new Error('Invalid CDP visibility response'));}
  };
  const onError=()=>finish(new Error('CDP read-only visibility socket error'));
  const onClose=()=>finish(new Error('CDP read-only visibility connection closed'));
  const listeners:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[
   ['open',onOpen],['message',onMessage],['error',onError],['close',onClose],
  ];
  const timer=setTimeout(()=>finish(new Error('CDP read-only visibility timeout')),timeoutMs);
  for(const [event,handler] of listeners)socket.addEventListener(event,handler);
 });
}
