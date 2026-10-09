import {createHash} from 'node:crypto';
import type {ChromeTarget} from './index.ts';
import {validateCdpPageSocket} from './endpoint.ts';
import type {SocketLike} from './snapshot.ts';
export interface LiteralLocator {method:string;expression:string;runtimeRequired:boolean}
export interface LocatorCheck {method:string;expression:string;status:'found'|'missing'|'ambiguous'|'unverified'|'blocked';matchCount:number|null;reason?:string;nodeFingerprint?:string}
export interface LocatorProbeResult {targetId:string;url:string;validationLevel:'dom-only';checks:LocatorCheck[]}
/** Bound every untrusted CDP reply before JSON parsing; oversized evidence is inconclusive. */
const MAX_REPLY_BYTES=1_000_000;
const MAX_MATCHED_NODES=10_000;
function validatedNodeCount(nodeIds:unknown):number{
 if(!Array.isArray(nodeIds))throw new Error('Invalid CDP selector node list');
 if(nodeIds.length>MAX_MATCHED_NODES)throw new Error('CDP selector match count limit exceeded');
 const seen=new Set<number>();
 for(const nodeId of nodeIds){
  if(!Number.isSafeInteger(nodeId)||nodeId<1||seen.has(nodeId))
   throw new Error('Invalid or duplicate CDP selector node ID');
  seen.add(nodeId);
 }
 return nodeIds.length;
}
function escapeIdentifier(value:string):string {
 return [...value].map((char,index)=>{
  if(/[a-zA-Z_-]/.test(char)||(/[0-9]/.test(char)&&index!==0))return char;
  if(char===' ')return '\\ ';
  return '\\'+char.codePointAt(0)!.toString(16)+' ';
 }).join('');
}
export function asCss(input:LiteralLocator):string|null{
 if(input.runtimeRequired||!input.expression||input.expression.length>1024)return null;
 if(input.method==='querySelector'||input.method==='querySelectorAll')return input.expression;
 if(input.method==='getElementById')return '#'+escapeIdentifier(input.expression);
 if(input.method==='getElementsByName'){
  // CSS attribute values are strings, not identifier tokens. Reject unsafe control bytes.
  if(/[\u0000-\u001f\u007f]/.test(input.expression)||input.expression.length>256)return null;
  const escaped=input.expression.replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  return '[name="'+escaped+'"]';
 }
 if(input.method==='getElementsByClassName'){
  const tokens=input.expression.trim().split(/\s+/).filter(Boolean);
  return tokens.length?tokens.map(x=>'.'+escapeIdentifier(x)).join(''):null;
 }
 return null;
}
/** Read-only DOM domain queries; no JS eval and no userscript execution. */
export async function probePageLocators(target:ChromeTarget,locators:readonly LiteralLocator[],options:{socketFactory?:(url:string)=>SocketLike;timeoutMs?:number;includeNodeFingerprints?:boolean}={}):Promise<LocatorProbeResult>{
 if(locators.length>50)throw new Error('Too many locators: maximum 50');
 if(options.includeNodeFingerprints!==undefined&&typeof options.includeNodeFingerprints!=='boolean')
  throw new Error('Invalid identity sampling configuration');
 const endpoint=validateCdpPageSocket(target);
 const timeout=options.timeoutMs??8000;if(!Number.isInteger(timeout)||timeout<100||timeout>30000)throw new Error('Invalid CDP probe timeout');
 const checks:LocatorCheck[]=locators.map(x=>({method:x.method,expression:x.expression,status:'unverified',matchCount:null,reason:'仅支持 document 作用域的静态 CSS 定位器'}));
 if(!locators.some(x=>asCss(x)!==null))return {targetId:target.id,url:target.url,validationLevel:'dom-only',checks};
 const socket=(options.socketFactory??((address:string)=>new WebSocket(address) as unknown as SocketLike))(endpoint);
 return await new Promise<LocatorProbeResult>((resolve,reject)=>{
  let finished=false,id=0,rootId=0,documentReceived=false;
  const pending=new Map<number,number>();
  const fingerprintPending=new Map<number,number>();
  const finishIfReady=()=>{if(pending.size===0&&fingerprintPending.size===0)complete();};
  const complete=(error?:Error)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   for(const [name,fn] of handlers)socket.removeEventListener(name,fn);
   try{socket.close();}catch{}
   if(error)reject(error);else resolve({targetId:target.id,url:target.url,validationLevel:'dom-only',checks});
  };
  const onOpen=()=>{try{socket.send(JSON.stringify({id:++id,method:'DOM.getDocument',params:{depth:0,pierce:false}}));}catch(error){complete(error as Error);}};
  const onMessage=(event:{data:unknown})=>{
   try{
    if(typeof event.data!=='string'||event.data.length>MAX_REPLY_BYTES)
     throw new Error('CDP locator response size limit exceeded');
    const message=JSON.parse(event.data);
    if(!Number.isSafeInteger(message.id)||message.id<1||finished)return;
    if(message.id===1){
     if(documentReceived)throw new Error('Duplicate CDP document root reply');
     documentReceived=true;
     if(message.error)throw new Error('CDP document root request rejected');
     rootId=message.result?.root?.nodeId;
     if(!Number.isSafeInteger(rootId)||rootId<1)throw new Error('Invalid CDP document root');
     for(let i=0;i<locators.length;i++){
      const css=asCss(locators[i]!);if(css===null)continue;
      const commandId=++id;pending.set(commandId,i);
      socket.send(JSON.stringify({id:commandId,method:'DOM.querySelectorAll',params:{nodeId:rootId,selector:css}}));
     }
     finishIfReady();
    }else if(pending.has(message.id)){
     const index=pending.get(message.id)!;pending.delete(message.id);const check=checks[index]!;
     if(message.error){check.status='blocked';check.reason='CSS 选择器无效或目标浏览器拒绝定位';}
     else{
      const nodeIds=message.result?.nodeIds;
      const count=validatedNodeCount(nodeIds);check.matchCount=count;
      check.status=count===0?'missing':count===1||['querySelectorAll','getElementsByName','getElementsByClassName'].includes(locators[index]!.method)?'found':'ambiguous';
      check.reason=count===0?'当前 document 无匹配节点':count>1?'匹配多个节点，请确认目标':'当前 document 存在匹配节点';
      if(options.includeNodeFingerprints===true&&count===1){
       // Backend IDs are stable across independent DOM CDP sessions for the same
       // document; frontend node IDs are not. Never return raw backend IDs.
       check.status='unverified';check.reason='CDP backend node identity not yet confirmed';
       const identityId=++id;fingerprintPending.set(identityId,index);
       socket.send(JSON.stringify({id:identityId,method:'DOM.describeNode',params:{nodeId:nodeIds[0],depth:0,pierce:false}}));
      }
     }
     finishIfReady();
    }else if(fingerprintPending.has(message.id)){
     const index=fingerprintPending.get(message.id)!;
     fingerprintPending.delete(message.id);
     const check=checks[index]!;
     const backendId=message.result?.node?.backendNodeId;
     const nodeType=message.result?.node?.nodeType;
     if(!message.error&&Number.isSafeInteger(backendId)&&backendId>0&&nodeType===1){
      check.nodeFingerprint=createHash('sha256').update('usshm-cdp-backend-node-v1:').update(String(backendId)).digest('hex');
      check.status='found';
      check.reason='当前 document 存在匹配节点，且已验证 backend 节点身份';
     }else{
      check.status='unverified';
      check.reason='CDP backend 节点身份无效或不可用';
     }
     finishIfReady();
    }
   }catch(error){complete(error instanceof Error?error:new Error('Invalid CDP response'));}
  };
  const onError=()=>complete(new Error('CDP socket error'));
  const onClose=()=>complete(new Error('CDP socket closed before locator results'));
  const handlers:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[['open',onOpen],['message',onMessage],['error',onError],['close',onClose]];
  const timer=setTimeout(()=>complete(new Error('CDP locator probe timeout')),timeout);
  for(const [name,fn] of handlers)socket.addEventListener(name,fn);
 });
}
