import {createHmac,randomBytes} from 'node:crypto';
import type {ChromeTarget} from './index.ts';
import {validateCdpPageSocket} from './endpoint.ts';
import type {SocketLike} from './snapshot.ts';
export interface LiteralLocator {method:string;expression:string;runtimeRequired:boolean}
export interface LocatorCheck {method:string;expression:string;status:'found'|'missing'|'ambiguous'|'unverified'|'blocked';matchCount:number|null;reason?:string;nodeFingerprint?:string;nodeFingerprints?:readonly string[]}
export interface LocatorProbeResult {targetId:string;url:string;validationLevel:'dom-only';checks:LocatorCheck[]}
/** Bound every untrusted CDP reply before JSON parsing; oversized evidence is inconclusive. */
const MAX_REPLY_BYTES=1_000_000;
const MAX_MATCHED_NODES=10_000;
const MAX_IDENTITIES_PER_LOCATOR=10;
const MAX_IDENTITIES_PER_PROBE=100;
// Process-local secret prevents a backendNodeId from being guessed from its digest.
// It is never stored, logged, or exposed through Electron IPC.
const NODE_ID_HMAC_KEY=randomBytes(32);
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

/** Top document only: never use iframe contentDocument or Runtime.evaluate.
 * A bounded, complete CDP pierce tree may expose one author OPEN shadow root.
 * User-agent/closed roots and multiple open roots remain unsupported. */
function selectSingleOpenShadowRoot(root:unknown):number|null{
 if(!root||typeof root!=='object')return null;
 const queue:unknown[]=[root];
 const seen=new Set<number>();
 let openRoot:number|null=null;
 for(let i=0;i<queue.length;i++){
  if(i>=1500)return null;
  const node=queue[i];
  if(!node||typeof node!=='object'||Array.isArray(node))return null;
  const data=node as {nodeId?:unknown;children?:unknown;shadowRoots?:unknown;shadowRootType?:unknown};
  const id=data.nodeId;
  if(!Number.isSafeInteger(id)||typeof id!=='number'||id<1||seen.has(id))return null;
  seen.add(id);
  if(data.shadowRootType!==undefined){
   if(data.shadowRootType==='closed'||data.shadowRootType==='user-agent')continue;
   if(data.shadowRootType!=='open')return null;
   if(openRoot!==null)return null;
   openRoot=id;
  }
  if(data.children!==undefined){
   if(!Array.isArray(data.children))return null;
   queue.push(...data.children);
  }
  if(data.shadowRoots!==undefined){
   if(!Array.isArray(data.shadowRoots))return null;
   queue.push(...data.shadowRoots);
  }
  if(queue.length>1500)return null;
 }
 return openRoot;
}


/** Resolve one same-process iframe contentDocument by its CDP frame ID.
 * The caller MUST pin its same-origin loader through Page.getFrameTree.
 * Never inspect OOPIF/remote frame targets or crawl ShadowRoot children here. */
function selectSingleIframeDocument(root:unknown,expectedFrameId:string):number|null{
 if(!root||typeof root!=='object'||Array.isArray(root))return null;
 const queue:unknown[]=[root];
 const seen=new Set<number>();
 let found:number|null=null;
 for(let i=0;i<queue.length;i++){
  if(i>=1500)return null;
  const current=queue[i];
  if(!current||typeof current!=='object'||Array.isArray(current))return null;
  const node=current as {nodeId?:unknown;nodeName?:unknown;frameId?:unknown;children?:unknown;contentDocument?:unknown};
  if(!Number.isSafeInteger(node.nodeId)||typeof node.nodeId!=='number'||
     node.nodeId<1||seen.has(node.nodeId))return null;
  seen.add(node.nodeId);
  if(node.frameId===expectedFrameId){
   if(node.nodeName!=='IFRAME'||found!==null||
      !node.contentDocument||typeof node.contentDocument!=='object'||
      Array.isArray(node.contentDocument))return null;
   const doc=node.contentDocument as {nodeId?:unknown};
   if(!Number.isSafeInteger(doc.nodeId)||typeof doc.nodeId!=='number'||doc.nodeId<1||
      seen.has(doc.nodeId))return null;
   found=doc.nodeId;
  }
  if(node.children!==undefined){
   if(!Array.isArray(node.children))return null;
   queue.push(...node.children);
  }
  if(queue.length>1500)return null;
 }
 return found;
}

function escapeIdentifier(value:string):string {
 return [...value].map((char,index)=>{
  // CSS identifiers cannot be a lone hyphen or begin with a hyphen-digit.
  // DOM.getElementById and getElementsByClassName can legitimately use both.
  if(index===0&&char==='-'&&value==='-')return '\\-';
  if(index===1&&value[0]==='-'&&/[0-9]/.test(char))
   return '\\'+char.codePointAt(0)!.toString(16)+' ';
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
export async function probePageLocators(target:ChromeTarget,locators:readonly LiteralLocator[],options:{socketFactory?:(url:string)=>SocketLike;timeoutMs?:number;includeNodeFingerprints?:boolean;rootScope?:'document'|'open-shadow'|'iframe-document';expectedFrameId?:string}={}):Promise<LocatorProbeResult>{
 if(locators.length>50)throw new Error('Too many locators: maximum 50');
 if(options.includeNodeFingerprints!==undefined&&typeof options.includeNodeFingerprints!=='boolean')
  throw new Error('Invalid identity sampling configuration');
 if(options.rootScope!==undefined&&options.rootScope!=='document'&&
    options.rootScope!=='open-shadow'&&options.rootScope!=='iframe-document')
  throw new Error('Invalid CDP locator root scope');
 if(options.rootScope==='iframe-document'){
  if(typeof options.expectedFrameId!=='string'||!(/^[a-zA-Z0-9_-]{1,256}$/).test(options.expectedFrameId))
   throw new Error('Trusted same-origin iframe frame ID required');
 }else if(options.expectedFrameId!==undefined)throw new Error('Unexpected iframe frame ID for document scope');
 const endpoint=validateCdpPageSocket(target);
 const timeout=options.timeoutMs??8000;if(!Number.isInteger(timeout)||timeout<100||timeout>30000)throw new Error('Invalid CDP probe timeout');
 const checks:LocatorCheck[]=locators.map(x=>({method:x.method,expression:x.expression,status:'unverified',matchCount:null,reason:'仅支持 document 作用域的静态 CSS 定位器'}));
 if(!locators.some(x=>asCss(x)!==null))return {targetId:target.id,url:target.url,validationLevel:'dom-only',checks};
 const socket=(options.socketFactory??((address:string)=>new WebSocket(address) as unknown as SocketLike))(endpoint);
 return await new Promise<LocatorProbeResult>((resolve,reject)=>{
  let finished=false,id=0,rootId=0,documentReceived=false;
  const pending=new Map<number,number>();
  interface IdentityGroup {readonly total:number;remaining:number;valid:boolean;readonly hashes:Set<string>}
  const fingerprintPending=new Map<number,{index:number;group:IdentityGroup}>();
  let identityRequests=0;
  const finishIfReady=()=>{if(pending.size===0&&fingerprintPending.size===0)complete();};
  const complete=(error?:Error)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   for(const [name,fn] of handlers)socket.removeEventListener(name,fn);
   try{socket.close();}catch{}
   if(error)reject(error);else resolve({targetId:target.id,url:target.url,validationLevel:'dom-only',checks});
  };
  const onOpen=()=>{try{
   const shadow=options.rootScope==='open-shadow'||options.rootScope==='iframe-document';
   socket.send(JSON.stringify({id:++id,method:'DOM.getDocument',
    params:{depth:shadow?-1:0,pierce:shadow}}));
  }catch(error){complete(error as Error);}};
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
     const documentRoot=message.result?.root;
     if(!Number.isSafeInteger(documentRoot?.nodeId)||documentRoot.nodeId<1)
      throw new Error('Invalid CDP document root');
     if(options.rootScope==='open-shadow'||options.rootScope==='iframe-document'){
      const selected=options.rootScope==='open-shadow'?
       selectSingleOpenShadowRoot(documentRoot):
       selectSingleIframeDocument(documentRoot,options.expectedFrameId!);
      if(selected===null){
       // No guessing, no accidental fallback to top document.
       for(const check of checks)check.reason=options.rootScope==='open-shadow'?
        'One bounded unambiguous author open ShadowRoot is required':
        'One bounded same-process iframe contentDocument must match the pinned frame ID';
       complete();
       return;
      }
      rootId=selected;
     }else rootId=documentRoot.nodeId;
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
      if(options.includeNodeFingerprints===true&&count>0){
       // Identity is bounded per role (max 10) and across the entire probe
       // (max 100 read-only describe calls). Never certify a partial set.
       if(count>MAX_IDENTITIES_PER_LOCATOR||identityRequests+count>MAX_IDENTITIES_PER_PROBE){
        check.status='unverified';
        check.reason='CDP backend node identity budget exceeded';
       }else{
        identityRequests+=count;
        check.status='unverified';
        check.reason='CDP backend node identities not yet confirmed';
        const group:IdentityGroup={total:count,remaining:count,valid:true,hashes:new Set()};
        for(const nodeId of nodeIds as number[]){
         const identityId=++id;
         fingerprintPending.set(identityId,{index,group});
         socket.send(JSON.stringify({id:identityId,method:'DOM.describeNode',params:{nodeId,depth:0,pierce:false}}));
        }
       }
      }
     }
     finishIfReady();
    }else if(fingerprintPending.has(message.id)){
     const {index,group}=fingerprintPending.get(message.id)!;
     fingerprintPending.delete(message.id);
     const check=checks[index]!;
     const backendId=message.result?.node?.backendNodeId;
     const nodeType=message.result?.node?.nodeType;
     if(!message.error&&Number.isSafeInteger(backendId)&&backendId>0&&nodeType===1){
      const hashed=createHmac('sha256',NODE_ID_HMAC_KEY)
       .update('usshm-cdp-backend-node-v1:').update(String(backendId)).digest('hex');
      if(group.hashes.has(hashed))group.valid=false;
      else group.hashes.add(hashed);
     }else group.valid=false;
     group.remaining--;
     if(group.remaining===0){
      if(group.valid&&group.hashes.size===group.total){
       const fingerprints=[...group.hashes].sort();
       if(group.total===1)check.nodeFingerprint=fingerprints[0]!;
       else check.nodeFingerprints=fingerprints;
       check.status='found';
       check.reason='已验证全部匹配节点的 CDP backend 身份';
      }else{
       check.status='unverified';
       check.reason='CDP backend 节点身份缺失、重复或无效';
      }
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
