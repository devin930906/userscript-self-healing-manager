import type {ChromeTarget} from '../../cdp-client/src/index.ts';
import {asCss,type LiteralLocator} from '../../cdp-client/src/locator-probe.ts';
import {validateCdpPageSocket} from '../../cdp-client/src/endpoint.ts';
import {assertCredentialFreePageUrl} from '../../cdp-client/src/page-url-safety.ts';
import {assertStablePageDocument,type ConfirmedPageIdentity} from '../../cdp-client/src/page-identity.ts';
import type {SocketLike} from '../../cdp-client/src/snapshot.ts';

export interface ApprovedControlFocusResult{
 readonly status:'focus-observed'|'needs-review';
 readonly validationLevel:'consented-control-focus';
 readonly V2:'focus-observed-only'|'blocked';
 readonly V3:'not-configured';readonly V4:'not-configured';
 readonly interactionVerified:boolean;readonly functionalVerified:false;
 readonly managerVerified:false;readonly reason:string;
}
type CdpResult={id:number;result?:Record<string,any>;error?:unknown};

/**
 * One explicitly consented low-impact DOM.focus operation. Can trigger
 * handlers, so never call automatically and never infer a safe user action,
 * userscript provenance, business effect or V3/V4 from focus.
 * Only a uniquely pinned <button type="button"> is allowed.
 */
export async function runApprovedControlFocus({approved,target,locator,approvedDocument,confirm,assertAuthorizedBeforeAction,socketFactory,timeoutMs=5000}:{
 approved:boolean;target:ChromeTarget;locator:LiteralLocator;
 /** Trusted Main's document identity checked across the native consent prompt. */
 approvedDocument:ConfirmedPageIdentity;
 confirm:(target:ChromeTarget)=>Promise<ConfirmedPageIdentity>;
 /** Trusted Main-owned synchronous revocation check at the last action boundary. */
 assertAuthorizedBeforeAction?:()=>void;
 socketFactory?:(url:string)=>SocketLike;timeoutMs?:number;
}):Promise<ApprovedControlFocusResult>{
 if(approved!==true)throw new Error('Explicit focus interaction approval required');
 if(!target||target.type!=='page'||typeof target.id!=='string'||!target.id||
    target.id.length>128)throw new Error('Invalid approved focus page target');
 assertCredentialFreePageUrl(target.url);
 const endpoint=validateCdpPageSocket(target);
 if(!locator||locator.runtimeRequired||typeof locator.expression!=='string'||
    !locator.expression.trim()||locator.expression.length>1024||
    !['querySelector','querySelectorAll','getElementById','getElementsByClassName','getElementsByName'].includes(locator.method))
  throw new Error('Static top-document selector required for focus');
 const css=asCss(locator);
 if(!css||css.length>2048)throw new Error('Unsupported focus selector');
 if(typeof confirm!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)
  throw new Error('Invalid focus identity or time budget');
 if(!approvedDocument||approvedDocument.targetId!==target.id||
    approvedDocument.confirmedUrl!==target.url||!approvedDocument.frameId||!approvedDocument.loaderId)
  throw new Error('Native-approved focus document identity required');
 // One monotonic budget covers identity lookup as well as the action socket.
 // Timer callbacks alone cannot guard a busy event loop's microtask boundary.
 const deadline=performance.now()+timeoutMs;
 const assertWithinBudget=()=>{
  if(performance.now()>=deadline)throw new Error('Approved focus timed out');
 };
 const identity=await confirm(target);
 assertWithinBudget();
 if(identity.targetId!==target.id||identity.confirmedUrl!==target.url||
    !identity.frameId||!identity.loaderId)
  throw new Error('Unverified focus main-frame identity');
 // Native approval belongs to a particular document, even when a reload
 // keeps its URL and target ID. Do not establish a replacement baseline.
 assertStablePageDocument(approvedDocument,identity);
 const guard=async()=>{
  assertWithinBudget();
  const current=await confirm(target);
  assertWithinBudget();
  assertStablePageDocument(identity,current);
 };
 const result=(observed:boolean):ApprovedControlFocusResult=>Object.freeze({
  status:observed?'focus-observed':'needs-review',
  validationLevel:'consented-control-focus',
  V2:observed?'focus-observed-only':'blocked',V3:'not-configured',V4:'not-configured',
  interactionVerified:observed,functionalVerified:false,managerVerified:false,
  reason:observed?'The same approved top-document button became focused after one CDP focus command; no named site function or userscript was verified':
   'The approved button focus could not be independently confirmed; no V2 interaction credit',
 });
 const socket=(socketFactory??((url:string)=>new WebSocket(url) as unknown as SocketLike))(endpoint);
 let sequence=0;
 let pending:{id:number;resolve:(value:Record<string,any>)=>void;reject:(error:Error)=>void}|null=null;
 let opened=false,finished=false;
 let aborted:Error|null=null;
 let openResolve:()=>void=()=>{},openReject:(error:Error)=>void=()=>{};
 const ready=new Promise<void>((resolve,reject)=>{openResolve=resolve;openReject=reject;});
 const error=(msg:string)=>new Error(msg);
 const abort=(reason:string)=>{
  if(aborted!==null)return;
  const e=error(reason);
  aborted=e;
  if(!opened)openReject(e);
  if(pending){const prior=pending;pending=null;prior.reject(e);}
 };
 const onOpen=()=>{opened=true;openResolve();};
 const onMessage=(event:{data:unknown})=>{
  if(finished||!pending)return;
  try{
   if(typeof event.data!=='string'||event.data.length>128000)
    throw error('Invalid bounded CDP focus response');
   const message:unknown=JSON.parse(event.data);
   if(!message||typeof message!=='object'||Array.isArray(message))
    throw error('Invalid CDP focus response');
   const reply=message as CdpResult;
   if(reply.id!==pending.id)return;
   const waiting=pending;pending=null;
   if(reply.error||!reply.result||typeof reply.result!=='object'||Array.isArray(reply.result))
    waiting.reject(error('CDP focus command did not return a valid result'));
   else waiting.resolve(reply.result);
  }catch{abort('Invalid CDP focus response');}
 };
 const onError=()=>abort('CDP focus connection error');
 const onClose=()=>abort('CDP focus connection closed');
 const handlers:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[
  ['open',onOpen],['message',onMessage],['error',onError],['close',onClose]];
 for(const [name,handler] of handlers)socket.addEventListener(name,handler);
 const timer=setTimeout(()=>abort('Approved focus timed out'),Math.max(1,deadline-performance.now()));
 const send=async(method:string,params:Record<string,unknown>={}):Promise<Record<string,any>>=>{
  // Deadline can expire while Page.getFrameTree is awaiting a slow response
  // with no CDP command pending. Never send DOM.focus (or any other command)
  // after the one-time approval budget is exhausted.
  assertWithinBudget();
  if(aborted!==null)throw aborted;
  if(pending||finished)throw error('Concurrent CDP focus command rejected');
  const id=++sequence;
  return new Promise<Record<string,any>>((resolve,reject)=>{
   pending={id,resolve,reject};
   try{socket.send(JSON.stringify({id,method,params}));}
   catch{pending=null;reject(error('Unable to send approved CDP focus command'));}
  });
 };
 try{
  await ready;
  const root=Number((await send('DOM.getDocument',{depth:0,pierce:false})).root?.nodeId);
  if(!Number.isSafeInteger(root)||root<1)throw error('Invalid DOM document for focus');
  // Style inspection is read-only. Failure to obtain computed visibility is
  // NOT permission to focus an invisible or layout-less control.
  await send('CSS.enable');
  const unique=async(selector:string)=>{
   const nodes=(await send('DOM.querySelectorAll',{nodeId:root,selector})).nodeIds;
   if(!Array.isArray(nodes)||nodes.length!==1||!Number.isSafeInteger(nodes[0])||nodes[0]<1)
    throw error('Focus requires exactly one verified DOM control');
   return nodes[0] as number;
  };
  const node=await unique(css);
  const described=(await send('DOM.describeNode',{nodeId:node})).node;
  if(!described||described.nodeName!=='BUTTON')
   throw error('Approved focus is limited to ordinary button controls');
  const attributes=(await send('DOM.getAttributes',{nodeId:node})).attributes;
  if(!Array.isArray(attributes)||attributes.length>80||attributes.length%2!==0)
   throw error('Invalid approved button attributes');
  const attrs=new Map<string,string>();
  for(let i=0;i<attributes.length;i+=2){
   if(typeof attributes[i]!=='string'||typeof attributes[i+1]!=='string'||
      attributes[i].length>128||attributes[i+1].length>2048||
      attrs.has(attributes[i].toLowerCase()))
    throw error('Invalid approved button attributes');
   attrs.set(attributes[i].toLowerCase(),attributes[i+1]);
  }
  if(attrs.get('type')!=='button'||attrs.has('disabled')||attrs.has('inert')||attrs.has('hidden')||
     (attrs.has('aria-disabled')&&attrs.get('aria-disabled')!=='false')||
     (attrs.has('aria-hidden')&&attrs.get('aria-hidden')!=='false'))
   throw error('Button type or disabled state blocks approved focus');
  // A button can be syntactically safe and uniquely addressed but not even
  // rendered (display:none, visibility:hidden, opacity:0 or zero layout).
  // DOM.focus is still observable and may trigger page listeners. Require
  // computed style and real geometry before an explicitly approved action;
  // this does NOT prove unobscured viewport visibility or named functionality.
  const rendered=async()=>{
   const values=(await send('CSS.getComputedStyleForNode',{nodeId:node})).computedStyle;
   if(!Array.isArray(values)||values.length<1||values.length>500)
    throw error('Unverified computed focus visibility');
   const wanted=new Set(['display','visibility','opacity','content-visibility']);
   const selected=new Map<string,string>();
   for(const value of values){
    if(!value||typeof value!=='object'||typeof value.name!=='string'||
       typeof value.value!=='string'||value.value.length>128)continue;
    if(wanted.has(value.name)){
     if(selected.has(value.name))throw error('Ambiguous computed focus visibility');
     selected.set(value.name,value.value);
    }
   }
   const opacity=Number(selected.get('opacity'));
   if(!selected.has('display')||selected.get('display')==='none'||
      selected.get('visibility')!=='visible'||
      !selected.has('opacity')||!Number.isFinite(opacity)||opacity<=0||
      selected.get('content-visibility')==='hidden')
    throw error('Invisible approved button cannot receive focus');
   const box=(await send('DOM.getBoxModel',{nodeId:node})).model;
   if(!box||typeof box!=='object'||
      ![box.width,box.height].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=100000))
    throw error('Approved focus control has no safe rendered layout');
   return JSON.stringify({
    display:selected.get('display'),visibility:selected.get('visibility'),
    opacity:selected.get('opacity'),contentVisibility:selected.get('content-visibility')??'visible',
    width:box.width,height:box.height,
   });
  };
  const beforeRendered=await rendered();
  if(await unique(css)!==node)
   throw error('Approved button changed before focus');
  // A handler, live page update, or accessibility mutation can turn a
  // previously ordinary button into a submit/disabled control between
  // inspection and focus. Re-read the same node's attributes at the
  // final action boundary and refuse any changed snapshot.
  const finalAttributes=(await send('DOM.getAttributes',{nodeId:node})).attributes;
  if(!Array.isArray(finalAttributes)||
     finalAttributes.length!==attributes.length||
     finalAttributes.some((value:unknown,index:number)=>value!==attributes[index]))
   throw error('Approved button attributes changed before focus');
  if(await rendered()!==beforeRendered)
   throw error('Approved focus visibility changed before action');
  // A post-focus :focus match is not evidence of a new interaction if this
  // button was already focused before the consented command. Preserve that
  // distinction even in a page that changes focus without our action.
  const beforeFocus=(await send('DOM.querySelectorAll',{nodeId:root,selector:':focus'})).nodeIds;
  if(!Array.isArray(beforeFocus)||beforeFocus.length>1||
     beforeFocus.some((id:unknown)=>!Number.isSafeInteger(id)||Number(id)<1))
   throw error('Invalid pre-action focus evidence');
  if(beforeFocus.includes(node))
   throw error('Approved button already focused; no verifiable new focus transition');
  await guard();
  // A scan or directory approval may be revoked while the CDP preflight yields.
  // Production Main owns the check; it runs synchronously, just before focus.
  assertAuthorizedBeforeAction?.();
  // No fallback or retry after this potentially observable operation.
  await send('DOM.focus',{nodeId:node});
  const focus=(await send('DOM.querySelectorAll',{nodeId:root,selector:':focus'})).nodeIds;
  await guard();
  return result(Array.isArray(focus)&&focus.length===1&&focus[0]===node);
 }finally{
  finished=true;clearTimeout(timer);pending=null;
  for(const [name,handler]of handlers)socket.removeEventListener(name,handler);
  try{socket.close();}catch{}
 }
}
