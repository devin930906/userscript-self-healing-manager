import type {ChromeTarget} from './index.ts';
import {validateCdpPageSocket} from './endpoint.ts';
import type {SocketLike} from './snapshot.ts';
import {isSafeLocatorToken,type SafeDomNode} from '../../candidate-engine/src/index.ts';
const ALLOWED=new Set(['id','data-testid','data-test','data-qa','name','class']);
const NODE_LIMIT=5000;
const MAX_MESSAGE=3_000_000;
export interface CandidateDomEvidence {
 readonly targetId:string;
 readonly url:string;
 readonly scope:'top-document';
 readonly nodeCount:number;
 readonly nodes:SafeDomNode[];
}
/** Reads only a bounded set of safe identifier attributes; never returns text, input values or arbitrary DOM. */
export async function captureCandidateNodes(target:ChromeTarget,options:{socketFactory?:(url:string)=>SocketLike;timeoutMs?:number}={}):Promise<CandidateDomEvidence>{
 const endpoint=validateCdpPageSocket(target);
 const timeoutMs=options.timeoutMs??6500;
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw new Error('Invalid snapshot timeout');
 const socket=(options.socketFactory??((url:string)=>new WebSocket(url) as unknown as SocketLike))(endpoint);
 return new Promise<CandidateDomEvidence>((resolve,reject)=>{
  let finished=false;
  const complete=(error?:Error,result?:CandidateDomEvidence)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   for(const [event,handler] of handlers)socket.removeEventListener(event,handler);
   try{socket.close();}catch{}
   if(error)reject(error);else if(result)resolve(result);
  };
  const onOpen=()=>{
   try{socket.send(JSON.stringify({id:1,method:'DOMSnapshot.captureSnapshot',params:{computedStyles:[],includePaintOrder:false,includeDOMRects:false}}));}
   catch(err){complete(err instanceof Error?err:new Error('Failed to request DOM snapshot'));}
  };
  const onMessage=(event:{data:unknown})=>{
   try{
    if(typeof event.data!=='string'||event.data.length>MAX_MESSAGE)throw new Error('DOM snapshot payload limit exceeded');
    const m=JSON.parse(event.data);
    if(m.id!==1)return;
    if(m.error)throw new Error('CDP DOM snapshot failed');
    const strings=m.result?.strings;
    const docs=m.result?.documents;
    if(!Array.isArray(strings)||!Array.isArray(docs)||docs.length===0||!docs[0]?.nodes)throw new Error('Invalid DOM snapshot document');
    const raw=docs[0].nodes;
    if(!Array.isArray(raw.nodeName)||!Array.isArray(raw.attributes)||raw.nodeName.length!==raw.attributes.length)throw new Error('Invalid DOM snapshot nodes');
    if(raw.nodeName.length>NODE_LIMIT)throw new Error('DOM candidate node limit exceeded');
    const nodes:SafeDomNode[]=[];
    for(let i=0;i<raw.nodeName.length;i++){
     const tag=strings[raw.nodeName[i]];
     if(typeof tag!=='string'||!/^[A-Za-z][A-Za-z0-9-]{0,30}$/.test(tag))continue;
     const rawAttrs=raw.attributes[i];
     if(!Array.isArray(rawAttrs)||rawAttrs.length%2||rawAttrs.length>60)continue;
     const attributes:Record<string,string>={};
     for(let j=0;j<rawAttrs.length;j+=2){
      const key=strings[rawAttrs[j]],value=strings[rawAttrs[j+1]];
      if(typeof key!=='string'||typeof value!=='string'||!ALLOWED.has(key))continue;
      if(key==='class') {
       const classes=value.split(/\s+/).filter(isSafeLocatorToken).slice(0,5);
       if(classes.length)attributes[key]=classes.join(' ');
      }else if(isSafeLocatorToken(value))attributes[key]=value;
     }
     if(Object.keys(attributes).length)nodes.push({tagName:tag,attributes});
    }
    complete(undefined,{targetId:target.id,url:target.url,scope:'top-document',nodeCount:raw.nodeName.length,nodes});
   }catch(err){complete(err instanceof Error?err:new Error('Invalid CDP snapshot message'));}
  };
  const onError=()=>complete(new Error('CDP snapshot socket error'));
  const onClose=()=>complete(new Error('CDP snapshot socket closed'));
  const handlers:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[['open',onOpen],['message',onMessage],['error',onError],['close',onClose]];
  const timer=setTimeout(()=>complete(new Error('CDP candidate snapshot timeout')),timeoutMs);
  for(const [event,handler] of handlers)socket.addEventListener(event,handler);
 });
}
