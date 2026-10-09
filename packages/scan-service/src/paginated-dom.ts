import type {BatchDomItem,BatchDomResult} from './batch-dom.ts';
import type {BatchPauseGate} from './pause-gate.ts';

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
function requireValidPage(page:PaginatedDomPage,{offset,total,targetId,pageUrl,pageDocumentToken,expectedItems}:{
 offset:number;total:number;targetId:string;pageUrl:string|null;
 pageDocumentToken:string|null;
 expectedItems:readonly {scriptId?:string|undefined;path:string}[]|undefined;
}):void{
 const count=Math.min(25,total-offset);
 if(page.validationLevel!=='dom-only'||page.pageTargetId!==targetId||
    !page.pageUrl||!/^https?:\/\//.test(page.pageUrl)||
    pageUrl!==null&&page.pageUrl!==pageUrl)
  throw new Error('CDP page identity or URL changed during paginated diagnosis');
 if(page.pageDocumentToken!==undefined&&!/^[0-9a-f]{64}$/.test(page.pageDocumentToken))
  throw new Error('Invalid CDP page document identity token');
 if(offset>0&&(page.pageDocumentToken??null)!==pageDocumentToken)
  throw new Error('CDP page document identity changed during paginated diagnosis (same-URL reload)');
 if(page.startIndex!==offset||page.totalItems!==count||page.items.length!==count||
    page.remainingItems!==total-offset-count)
  throw new Error('Invalid or partial CDP pagination result');
 for(let i=0;i<page.items.length;i++) {
  const row=page.items[i];
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
function isTransientCdpReadError(error:unknown):boolean{
 if(!(error instanceof Error))return false;
 return /^(?:CDP page identity timeout|CDP page identity socket error|CDP page identity socket closed before response|CDP locator probe timeout|CDP socket error|CDP socket closed before locator results|CDP snapshot timeout|CDP candidate snapshot timeout)$/.test(error.message);
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
 pauseGate?:Pick<BatchPauseGate,'waitUntilReady'>;
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
 for(let offset=0;offset<total;offset+=25){
  let page:PaginatedDomPage|undefined;
  for(let attempt=0;attempt<=retryTransportFailures;attempt++){
   if(isCancelled())break;
   if(pauseGate&&!(await pauseGate.waitUntilReady()))break;
   if(isCancelled())break;
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
  if(isCancelled()||!page)break;
  requireValidPage(page,{offset,total,targetId,pageUrl,pageDocumentToken,expectedItems});
  pageUrl=page.pageUrl;
  pageDocumentToken=page.pageDocumentToken??null;
  items.push(...page.items);
  onProgress({validationLevel:'dom-only',pageTargetId:targetId,pageUrl,...(pageDocumentToken?{pageDocumentToken}:{}),items:[...items],totalItems:items.length,remainingItems:total-items.length});
 }
 return {validationLevel:'dom-only',pageTargetId:targetId,pageUrl:pageUrl??'',...(pageDocumentToken?{pageDocumentToken}:{}),totalItems:items.length,
  remainingItems:total-items.length,cancelled:isCancelled(),items};
}
