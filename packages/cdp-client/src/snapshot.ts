import type {ChromeTarget} from './index.ts';
export interface SocketLike {
 addEventListener(type:'open'|'message'|'error'|'close',listener:(event:any)=>void):void;
 removeEventListener(type:'open'|'message'|'error'|'close',listener:(event:any)=>void):void;
 send(data:string):void;
 close():void;
}
export interface DomSummary {targetId:string;url:string;documentCount:number;nodeCount:number;validationLevel:'evidence-only'}
/** Count-only snapshot: no raw DOM text leaves this module. */
export async function captureDomSummary(target:ChromeTarget,options:{socketFactory?:(url:string)=>SocketLike;timeoutMs?:number}={}):Promise<DomSummary>{
 const endpoint=target.webSocketDebuggerUrl;
 if(!endpoint)throw new Error('CDP target has no debugger socket');
 const parsed=new URL(endpoint);
 if(parsed.protocol!=='ws:'||!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.username||parsed.password)throw new Error('CDP WebSocket must use loopback without credentials');
 if(!/^\/devtools\/page\/[^/]+$/.test(parsed.pathname)||!parsed.pathname.endsWith('/'+encodeURIComponent(target.id)))throw new Error('CDP page target socket does not match target id');
 const timeout=options.timeoutMs??3500;
 if(!Number.isInteger(timeout)||timeout<100||timeout>30000)throw new Error('Invalid CDP timeout');
 const socket=(options.socketFactory??((value:string)=>new WebSocket(value) as unknown as SocketLike))(endpoint);
 return await new Promise<DomSummary>((resolve,reject)=>{
  let finished=false;
  const complete=(error?:Error,summary?:DomSummary)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   for(const [name,fn] of handlers)socket.removeEventListener(name,fn);
   try{socket.close();}catch{}
   if(error)reject(error);else if(summary)resolve(summary);
  };
  const onOpen=()=>{try{socket.send(JSON.stringify({id:1,method:'DOMSnapshot.captureSnapshot',params:{computedStyles:[],includePaintOrder:false,includeDOMRects:false}}));}catch(error){complete(error instanceof Error?error:new Error('Cannot send CDP snapshot request'));}};
  const onMessage=(event:{data:unknown})=>{
   try{
    const message=JSON.parse(String(event.data));if(message.id!==1)return;
    if(message.error)throw new Error('CDP snapshot failed');
    const documents=message.result?.documents;
    if(!Array.isArray(documents)||documents.length===0)throw new Error('Invalid DOM snapshot response');
    let count=0;
    for(const doc of documents){if(!Array.isArray(doc?.nodes?.nodeName))throw new Error('Invalid DOM snapshot nodes');count+=doc.nodes.nodeName.length;}
    complete(undefined,{targetId:target.id,url:target.url,documentCount:documents.length,nodeCount:count,validationLevel:'evidence-only'});
   }catch(error){complete(error instanceof Error?error:new Error('Invalid CDP response'));}
  };
  const onError=()=>complete(new Error('CDP socket error'));
  const onClose=()=>complete(new Error('CDP socket closed before snapshot response'));
  const handlers:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[['open',onOpen],['message',onMessage],['error',onError],['close',onClose]];
  const timer=setTimeout(()=>complete(new Error('CDP snapshot timeout')),timeout);
  for(const [name,fn] of handlers)socket.addEventListener(name,fn);
 });
}
