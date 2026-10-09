import type {BatchDomResult,BatchDomItem} from './batch-dom.ts';
import type {PaginatedDomPage} from './paginated-dom.ts';

/**
 * Electron-main-owned evidence: the renderer can request a file export but
 * cannot supply or modify its diagnosis contents. A new scan invalidates it.
 */
export class BatchEvidenceStore {
 private revisionNumber=0;
 private active:{
  scanId:string;targetId:string;pageUrl:string;token:string;
  total:number;items:BatchDomItem[];observedAt:string;
 }|null=null;
 clear():void{this.active=null;this.revisionNumber++;}
 invalidateIfCurrent({scanId,targetId}:{scanId:string;targetId:string}):void{
  if(this.active?.scanId===scanId&&this.active.targetId===targetId)this.clear();
 }
 record({scanId,targetId,total,offset,page}:{
  scanId:string;targetId:string;total:number;offset:number;page:PaginatedDomPage;
 }):void{
  if(typeof scanId!=='string'||!scanId||scanId.length>128||
     typeof targetId!=='string'||!targetId||targetId.length>128||
     !Number.isSafeInteger(total)||total<1||total>1000||
     !Number.isSafeInteger(offset)||offset<0||offset>=total||offset%25!==0)
   throw new Error('Invalid diagnosis evidence binding');
  const expectedSize=Math.min(25,total-offset);
  const token=page.pageDocumentToken;
  if(!token||!/^[0-9a-f]{64}$/.test(token)||page.validationLevel!=='dom-only'||
     page.pageTargetId!==targetId||!/^https?:\/\//.test(page.pageUrl)||
     page.startIndex!==offset||page.totalItems!==expectedSize||
     page.remainingItems!==total-offset-expectedSize||!Array.isArray(page.items)||
     page.items.length!==expectedSize||
     page.items.some((item,i)=>item?.index!==offset+i)){
   this.clear();
   throw new Error('Invalid authenticated CDP evidence page');
  }
  if(offset===0){
   this.active={scanId,targetId,pageUrl:page.pageUrl,token,total,
    items:structuredClone([...page.items]),observedAt:new Date().toISOString()};
   this.revisionNumber++;
   return;
  }
  const state=this.active;
  if(!state||state.scanId!==scanId||state.targetId!==targetId||
     state.total!==total||state.items.length!==offset||
     state.pageUrl!==page.pageUrl||state.token!==token){
   this.clear();
   throw new Error('CDP document identity or script batch order changed; stale evidence invalidated');
  }
  state.items.push(...structuredClone([...page.items]));
  state.observedAt=new Date().toISOString();
  this.revisionNumber++;
 }
 snapshot({scanId,targetId}:{scanId:string;targetId:string}):{
  report:BatchDomResult;lastObservedAt:string;remainingItems:number;revision:number;
 }{
  const state=this.active;
  if(!state||state.scanId!==scanId||state.targetId!==targetId)
   throw new Error('Trusted DOM diagnosis unavailable or stale');
  return {report:{
   validationLevel:'dom-only',pageTargetId:state.targetId,pageUrl:state.pageUrl,
   pageDocumentToken:state.token,totalItems:state.items.length,
   items:structuredClone(state.items),
  },lastObservedAt:state.observedAt,remainingItems:state.total-state.items.length,revision:this.revisionNumber};
 }
}
