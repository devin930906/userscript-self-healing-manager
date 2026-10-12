import type {BatchDomItem,BatchDomResult} from './batch-dom.ts';
import type {BatchPauseGate} from './pause-gate.ts';
import {classifyReadOnlyFault} from './fault-classification.ts';

/** Narrow contract for Electron's explicitly consented 25-script batch IPC. */
export interface PaginatedDomPage extends BatchDomResult {
 readonly startIndex:number;
 readonly remainingItems:number;
}
export interface CompletedDomBatch extends BatchDomResult {
 readonly remainingItems:number;
 readonly cancelled:boolean;
}
export interface PaginatedDomProgress extends BatchDomResult {
 readonly remainingItems:number;
}
// The IPC bridge must not forward arbitrary exception text or extra object fields.
const PAGE_FIELDS=new Set(['validationLevel','pageTargetId','pageUrl','pageDocumentToken',
 'startIndex','totalItems','remainingItems','items']);
const ROW_FIELDS=new Set(['index','scriptId','path','status','checked','found','missing',
 'needsReview','reason','diagnostic','verification']);
const VERIFICATION_FIELDS=new Set(['V0','V1','V2','V3','V4','highestVerified',
 'functionalVerified','managerVerified']);
const FRAME_REASON='iframe browsing context detected; top-document evidence cannot verify nested frames';
const SHADOW_REASONS=[
 'Author Shadow DOM detected; top-document selector miss cannot inspect nested ShadowRoot',
 'Shadow DOM context evidence unavailable; top-document selector miss is not conclusive',
];
const INTERNAL_REASONS=new Set([
 'No valid static analysis',
 'Selector count exceeds batch safety limit',
 'Userscript page-scope rules exceed the safe evaluation budget or are malformed',
 'Invalid page URL','Only HTTP(S) CDP pages are supported',
 'Page matches @exclude-match','Unsupported @exclude-match prevents safe scope confirmation',
 'Page matches @exclude','Unsupported @exclude prevents safe scope confirmation',
 'Missing or unsupported @match/@include rule',
 'Selected page is not covered by @match/@include',
 'No selectors identified','Only dynamic or non-document locators',
 'CDP locator probe failed','CDP evidence identity or shape mismatch',
 'DOM recheck unverified; cannot certify a locator failure',
 FRAME_REASON,...SHADOW_REASONS,
 ...SHADOW_REASONS.map(reason=>FRAME_REASON+'; '+reason),
]);
/** Structured-clone results contain only own enumerable data properties. */
function onlyDataFields(value:unknown,allowed:ReadonlySet<string>):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 return Reflect.ownKeys(value).every(key=>{
  if(typeof key!=='string'||!allowed.has(key))return false;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor?.enumerable===true&&Object.hasOwn(descriptor,'value');
 });
}

/**
 * Every page is an IPC evidence boundary. Script/page identity alone does not
 * validate per-script counts or claimed verification levels.
 */
function assertValidDomRow(row:BatchDomItem|undefined):void{
 if(!onlyDataFields(row,ROW_FIELDS))
  throw new Error('Invalid paginated DOM evidence row payload');
 if(row.reason!==undefined&&!INTERNAL_REASONS.has(row.reason))
  throw new Error('Invalid paginated DOM reason: untrusted diagnostic text');
 const {checked,found,missing,needsReview,status}=row;
 if(![checked,found,missing,needsReview].every(n=>Number.isSafeInteger(n)&&n>=0)||
    checked>50||(checked===0?(found!==0||missing!==0||needsReview>50):
      found+missing+needsReview!==checked))
  throw new Error('Invalid paginated DOM evidence counters');
 const ordinaryZero=checked===0&&found===0&&missing===0&&needsReview===0;
 const statusValid=status==='dom-present'?
   checked>0&&found===checked&&missing===0&&needsReview===0:
  status==='locator-missing'?checked>0&&missing>0:
  status==='needs-review'?needsReview>0&&missing===0:
  ['no-evidence','out-of-scope','skipped','error'].includes(status)&&ordinaryZero;
 if(!statusValid)throw new Error('Invalid paginated DOM status versus evidence');
 // Fault attribution crosses the same renderer-facing IPC boundary as V1
 // evidence. A page producer may only include the exact closed classification
 // derivable from its authenticated status and trusted internal reason.
 // Never accept a claimed userscript/page source or arbitrary exception text.
 if(row.diagnostic!==undefined){
  const canonical=classifyReadOnlyFault(row);
  const received=row.diagnostic;
  const keys=['code','origin','category','attribution','functionalVerified'] as const;
  if(!canonical||!received||typeof received!=='object'||Array.isArray(received)||
     Reflect.ownKeys(received).length!==keys.length||
     Reflect.ownKeys(received).some(key=>typeof key!=='string'||!keys.includes(key as typeof keys[number])||
       Object.getOwnPropertyDescriptor(received,key)?.enumerable!==true)||
     keys.some(key=>received[key]!==canonical[key]))
   throw new Error('Invalid paginated fault attribution evidence');
 }
 const v=row.verification;
 if(v!==undefined){
  if(!onlyDataFields(v,VERIFICATION_FIELDS)||
     !['passed','failed','skipped','blocked','not-configured'].includes(v.V0)||
     !['passed','failed','skipped','blocked','not-configured'].includes(v.V1)||
     v.V2!=='blocked'||v.V3!=='not-configured'||v.V4!=='not-configured'||
     v.functionalVerified!==false||v.managerVerified!==false||
     (v.V1==='passed'&&(v.V0!=='passed'||status!=='dom-present'))||
     (v.V1==='failed'&&status!=='locator-missing')||
     (v.V1==='skipped'&&status!=='skipped'&&status!=='out-of-scope')||
     (v.V1==='not-configured'&&status!=='no-evidence')||
     v.highestVerified!==(v.V1==='passed'?'V1':v.V0==='passed'?'V0':null))
   throw new Error('Invalid paginated verification evidence or V-level escalation');
 }
}
function requireValidPage(page:PaginatedDomPage,{offset,total,targetId,pageUrl,pageDocumentToken,expectedItems}:{
 offset:number;total:number;targetId:string;pageUrl:string|null;
 pageDocumentToken:string|null;
 expectedItems:readonly {scriptId?:string|undefined;path:string}[]|undefined;
}):void{
 if(!onlyDataFields(page,PAGE_FIELDS)||!Array.isArray(page.items))
  throw new Error('Invalid paginated DOM page payload');
 const count=Math.min(25,total-offset);
 if(page.validationLevel!=='dom-only'||page.pageTargetId!==targetId||
    !page.pageUrl||!/^https?:\/\//.test(page.pageUrl)||
    pageUrl!==null&&page.pageUrl!==pageUrl)
  throw new Error('CDP page identity or URL changed during paginated diagnosis');
 // The producer must pin the main Frame and Loader on EVERY page. When
 // the first page omits a token, comparing only URL makes same-URL reloads
 // undetectable, even across 25-script pagination boundaries.
 if(typeof page.pageDocumentToken!=='string'||!/^[0-9a-f]{64}$/.test(page.pageDocumentToken))
  throw new Error('Missing or invalid CDP page document identity token');
 if(offset>0&&(page.pageDocumentToken??null)!==pageDocumentToken)
  throw new Error('CDP page document identity changed during paginated diagnosis (same-URL reload)');
 if(page.startIndex!==offset||page.totalItems!==count||page.items.length!==count||
    page.remainingItems!==total-offset-count)
  throw new Error('Invalid or partial CDP pagination result');
 for(let i=0;i<page.items.length;i++) {
  const row=page.items[i];
  assertValidDomRow(row);
  if(row?.index!==offset+i)
   throw new Error('CDP pagination item index mismatch');
  const expected=expectedItems?.[offset+i];
  if(expected&&(row?.scriptId!==(expected.scriptId??null)||row.path!==expected.path))
   throw new Error('CDP script identity changed during paginated diagnosis; stale scan evidence rejected');
 }
}
/**
 * Retry only known short-lived read-only CDP transport failures. In particular,
 * no page-document change, permission/scope error, malformed response, DOM
 * budget violation or arbitrary renderer-provided error is eligible.
 */
export function isTransientCdpReadError(error:unknown):boolean{
 if(!(error instanceof Error))return false;
 // Electron ipcRenderer.invoke wraps errors thrown by this named main handler.
 // Strip ONLY the exact transport envelope for our own read-only endpoint,
 // never an arbitrary error, different IPC method or appended explanation.
 const ipcPrefix="Error invoking remote method 'usshm:batch-diagnose': Error: ";
 const message=error.message.startsWith(ipcPrefix)?error.message.slice(ipcPrefix.length):error.message;
 return /^(?:CDP page identity timeout|CDP page identity socket error|CDP page identity socket closed before response|CDP locator probe timeout|CDP socket error|CDP socket closed before locator results|CDP snapshot timeout|CDP candidate snapshot timeout)$/.test(message);
}

/**
 * Serializes every batch under a single verified page URL, rejecting partial,
 * repeated or reordered pages before exposing them to the renderer. Stopping
 * only prevents future IPC requests: no promises of aborting an in-flight CDP call.
 */
export async function collectPagedDomDiagnosis({total,targetId,expectedItems,requestPage,isCancelled,pauseGate,retryTransportFailures=0,onProgress}:{
 total:number;targetId:string;
 expectedItems?:readonly {scriptId?:string|undefined;path:string}[];
 requestPage:(offset:number)=>Promise<PaginatedDomPage>;
 isCancelled:()=>boolean;
 /** Does not abort an in-flight page; gates only the next batch. */
 pauseGate?:Pick<BatchPauseGate,'waitUntilReady'|'isCancelled'>;
 /** Only bounded transport timeouts may be retried. Never retry changed identity. */
 retryTransportFailures?:0|1;
 onProgress:(result:PaginatedDomProgress)=>void;
}):Promise<CompletedDomBatch>{
 if(!Number.isSafeInteger(total)||total<0||total>1000||!targetId||targetId.length>128)
  throw new Error('Invalid paginated diagnosis request');
 if(expectedItems&&expectedItems.length!==total)throw new Error('Invalid expected script identity snapshot length');
 if(retryTransportFailures!==0&&retryTransportFailures!==1)throw new Error('Invalid CDP transport retry budget');
 const items:BatchDomItem[]=[];
 let pageUrl:string|null=null;
 let pageDocumentToken:string|null=null;
 let gateInterrupted=false;
 for(let offset=0;offset<total;offset+=25){
  let page:PaginatedDomPage|undefined;
  for(let attempt=0;attempt<=retryTransportFailures;attempt++){
   if(isCancelled())break;
   if(pauseGate&&!(await pauseGate.waitUntilReady())){
    gateInterrupted=true;
    break;
   }
   // The cooperative gate and the separate user cancellation callback
   // are independent revocation sources. Neither can authorize another
   // request after cancellation of the other.
   if(isCancelled()||pauseGate?.isCancelled===true)break;
   try{
    page=await requestPage(offset);
    break;
   }catch(error){
    // The browser/main process authenticates the frame and scan for each
    // attempt. A retry cannot silently cross a prior confirmed page identity.
    if(isCancelled())break;
    if(attempt>=retryTransportFailures||!isTransientCdpReadError(error))throw error;
   }
  }
  if(isCancelled()||pauseGate?.isCancelled===true||!page)break;
  requireValidPage(page,{offset,total,targetId,pageUrl,pageDocumentToken,expectedItems});
  pageUrl=page.pageUrl;
  pageDocumentToken=page.pageDocumentToken??null;
  items.push(...page.items);
  onProgress({validationLevel:'dom-only',pageTargetId:targetId,pageUrl,...(pageDocumentToken?{pageDocumentToken}:{}),items:[...items],totalItems:items.length,remainingItems:total-items.length});
 }
 return {validationLevel:'dom-only',pageTargetId:targetId,pageUrl:pageUrl??'',...(pageDocumentToken?{pageDocumentToken}:{}),totalItems:items.length,
  remainingItems:total-items.length,
  cancelled:isCancelled()||gateInterrupted||pauseGate?.isCancelled===true,items};
}
