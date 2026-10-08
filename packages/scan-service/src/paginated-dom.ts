import type {BatchDomItem,BatchDomResult} from './batch-dom.ts';

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
function requireValidPage(page:PaginatedDomPage,{offset,total,targetId,pageUrl,expectedItems}:{
 offset:number;total:number;targetId:string;pageUrl:string|null;
 expectedItems?:readonly {scriptId?:string|undefined;path:string}[];
}):void{
 const count=Math.min(25,total-offset);
 if(page.validationLevel!=='dom-only'||page.pageTargetId!==targetId||
    !page.pageUrl||!/^https?:\/\//.test(page.pageUrl)||
    pageUrl!==null&&page.pageUrl!==pageUrl)
  throw new Error('CDP page identity or URL changed during paginated diagnosis');
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
 * Serializes every batch under a single verified page URL, rejecting partial,
 * repeated or reordered pages before exposing them to the renderer. Stopping
 * only prevents future IPC requests: no promises of aborting an in-flight CDP call.
 */
export async function collectPagedDomDiagnosis({total,targetId,expectedItems,requestPage,isCancelled,onProgress}:{
 total:number;targetId:string;
 expectedItems?:readonly {scriptId?:string|undefined;path:string}[];
 requestPage:(offset:number)=>Promise<PaginatedDomPage>;
 isCancelled:()=>boolean;
 onProgress:(result:PaginatedDomProgress)=>void;
}):Promise<CompletedDomBatch>{
 if(!Number.isSafeInteger(total)||total<0||total>1000||!targetId||targetId.length>128)
  throw new Error('Invalid paginated diagnosis request');
 if(expectedItems&&expectedItems.length!==total)throw new Error('Invalid expected script identity snapshot length');
 const items:BatchDomItem[]=[];
 let pageUrl:string|null=null;
 for(let offset=0;offset<total;offset+=25){
  if(isCancelled())break;
  const page=await requestPage(offset);
  if(isCancelled())break;
  requireValidPage(page,{offset,total,targetId,pageUrl,expectedItems});
  pageUrl=page.pageUrl;
  items.push(...page.items);
  onProgress({validationLevel:'dom-only',pageTargetId:targetId,pageUrl,items:[...items],totalItems:items.length,remainingItems:total-items.length});
 }
 return {validationLevel:'dom-only',pageTargetId:targetId,pageUrl:pageUrl??'',totalItems:items.length,
  remainingItems:total-items.length,cancelled:isCancelled(),items};
}
