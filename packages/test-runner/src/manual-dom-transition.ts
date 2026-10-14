/** FR-025 user-paced two-stage *read-only* DOM observation; never a V2/V3 claim. */
export interface ManualDomTransitionBinding {
 readonly scanId:string;readonly scriptId:string;readonly itemIndex:number;
 readonly selectorIndex:number;readonly targetId:string;readonly pageUrl:string;
 readonly frameId:string;readonly loaderId:string;
}
export interface ManualDomTransitionResult{
 readonly status:'awaiting-user-action'|'changed-observed'|'unchanged';
 readonly beforeCount:number;readonly afterCount:number|null;
 readonly validationLevel:'V1-two-stage-manual-dom-observation';
 readonly V2:'blocked';readonly V3:'not-configured';readonly V4:'not-configured';
 readonly interactionVerified:false;readonly functionalVerified:false;readonly managerVerified:false;
}
const keys=['scanId','scriptId','targetId','pageUrl','frameId','loaderId'] as const;
function validBinding(b:ManualDomTransitionBinding):void {
 if(!b||typeof b!=='object'||Array.isArray(b)||
    keys.some(key=>typeof b[key]!=='string'||!b[key]||
     b[key].length>(key==='pageUrl'?4096:key==='frameId'||key==='loaderId'?256:128))||
    !Number.isSafeInteger(b.itemIndex)||b.itemIndex<0||
    !Number.isSafeInteger(b.selectorIndex)||b.selectorIndex<0)
  throw new Error('Invalid manual DOM observation binding');
 let url:URL;
 try{url=new URL(b.pageUrl);}catch{throw new Error('Invalid manual DOM observation page scope');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||
    !url.hostname||url.href!==b.pageUrl)
  throw new Error('Invalid manual DOM observation page scope');
}
function checkCount(v:number):void{
 if(!Number.isSafeInteger(v)||v<0||v>5000)
  throw new Error('Invalid manual DOM observation count');
}
function checkTime(t:number):void{
 if(!Number.isSafeInteger(t)||t<0)
  throw new Error('Invalid manual DOM observation time');
}
function receipt(status:ManualDomTransitionResult['status'],beforeCount:number,afterCount:number|null):ManualDomTransitionResult{
 return Object.freeze({
  status,beforeCount,afterCount,validationLevel:'V1-two-stage-manual-dom-observation',
  V2:'blocked',V3:'not-configured',V4:'not-configured',
  interactionVerified:false,functionalVerified:false,managerVerified:false,
 });
}
export class ManualDomTransitionGate {
 private pending:{binding:ManualDomTransitionBinding;beforeCount:number;started:number}|null=null;
 clear():void{this.pending=null;}
 begin({binding,beforeCount,now}:{binding:ManualDomTransitionBinding;beforeCount:number;now:number}):ManualDomTransitionResult{
  validBinding(binding);checkCount(beforeCount);checkTime(now);
  this.pending={binding:Object.freeze({...binding}),beforeCount,started:now};
  return receipt('awaiting-user-action',beforeCount,null);
 }
 assertPending(binding:ManualDomTransitionBinding,now:number):number{
  validBinding(binding);checkTime(now);
  const snapshot=this.pending;
  if(!snapshot)throw new Error('No pending manual DOM observation; start again');
  if(now<snapshot.started||now-snapshot.started>60_000)
   throw new Error('Manual DOM observation expired; start again');
  if(snapshot.binding.itemIndex!==binding.itemIndex||
     snapshot.binding.selectorIndex!==binding.selectorIndex||
     keys.some(key=>snapshot.binding[key]!==binding[key]))
   throw new Error('Manual DOM observation binding or document identity changed');
  return snapshot.beforeCount;
 }
 finish({binding,afterCount,now}:{binding:ManualDomTransitionBinding;afterCount:number;now:number}):ManualDomTransitionResult{
  try{
   const before=this.assertPending(binding,now);
   checkCount(afterCount);
   return receipt(before===afterCount?'unchanged':'changed-observed',before,afterCount);
  }finally{this.clear();}
 }
}
