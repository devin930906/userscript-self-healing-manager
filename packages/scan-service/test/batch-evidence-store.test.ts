import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BatchEvidenceStore} from '../src/batch-evidence-store.ts';
import type {PaginatedDomPage} from '../src/paginated-dom.ts';

const scanId='scan-a',targetId='target-a',url='https://example.org/private?q=token';
const token='a'.repeat(64);
const makePage=(offset:number,total=26,identity=token):PaginatedDomPage=>{
 const size=Math.min(25,total-offset);
 return {validationLevel:'dom-only',pageTargetId:targetId,pageUrl:url,
  pageDocumentToken:identity,startIndex:offset,totalItems:size,remainingItems:total-offset-size,
  items:Array.from({length:size},(_,i)=>({
   index:offset+i,scriptId:'script-'+(offset+i),path:'C:\\scripts\\s'+(offset+i)+'.user.js',
   status:'dom-present' as const,checked:1,found:1,missing:0,needsReview:0,
   verification:{V0:'passed' as const,V1:'passed' as const,V2:'blocked' as const,
    V3:'not-configured' as const,V4:'not-configured' as const,highestVerified:'V1' as const,
    functionalVerified:false as const,managerVerified:false as const},
  }))};
};
test('collects trusted CDP pages in scan order without accepting renderer-supplied grades',()=>{
 const store=new BatchEvidenceStore();
 store.record({scanId,targetId,total:26,offset:0,page:makePage(0)});
 assert.equal(store.snapshot({scanId,targetId}).report.items.length,25);
 store.record({scanId,targetId,total:26,offset:25,page:makePage(25)});
 const snapshot=store.snapshot({scanId,targetId});
 assert.equal(snapshot.report.totalItems,26);
 assert.equal(snapshot.remainingItems,0);
 assert.equal(snapshot.report.items[25]?.scriptId,'script-25');
 assert.match(snapshot.lastObservedAt,/^\d{4}-\d\d-\d\dT/);
});
test('rejects out-of-order pages and invalid report counts',()=>{
 const store=new BatchEvidenceStore();
 assert.throws(()=>store.record({scanId,targetId,total:26,offset:25,page:makePage(25)}),/first|order|offset/i);
 for(const bad of [
  {...makePage(0),remainingItems:99},
  {...makePage(0),items:makePage(0).items.slice(1)},
  {...makePage(0),pageDocumentToken:undefined},
 ]){
  assert.throws(()=>store.record({scanId,targetId,total:26,offset:0,page:bad}),/count|length|identity|token|page/i);
 }
});
test('on same-URL Chrome reload, invalidates all old evidence rather than preserving a plausible partial report',()=>{
 const store=new BatchEvidenceStore();
 store.record({scanId,targetId,total:26,offset:0,page:makePage(0)});
 assert.throws(()=>store.record({scanId,targetId,total:26,offset:25,page:makePage(25,26,'b'.repeat(64))}),/document|identity/i);
 assert.throws(()=>store.snapshot({scanId,targetId}),/missing|stale|unavailable/i);
});
test('new scan and changed target cannot obtain an old authenticated DOM diagnosis',()=>{
 const store=new BatchEvidenceStore();
 store.record({scanId,targetId,total:26,offset:0,page:makePage(0)});
 assert.throws(()=>store.snapshot({scanId:'different',targetId}),/missing|stale|unavailable/i);
 assert.throws(()=>store.snapshot({scanId,targetId:'different'}),/missing|stale|unavailable/i);
 store.clear();
 assert.throws(()=>store.snapshot({scanId,targetId}),/missing|stale|unavailable/i);
});
