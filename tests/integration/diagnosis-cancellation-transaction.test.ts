import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DiagnosisRequestGate} from '../../packages/scan-service/src/diagnosis-request-gate.ts';
import {BatchEvidenceStore} from '../../packages/scan-service/src/batch-evidence-store.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import type {PaginatedDomPage} from '../../packages/scan-service/src/paginated-dom.ts';

const scanId='snapshot-1',targetId='local-fixture-tab';
const documentToken='1'.repeat(64);
const page=(offset:number,total=26):PaginatedDomPage=>{
 const count=Math.min(25,total-offset);
 return {
  validationLevel:'dom-only',pageTargetId:targetId,pageUrl:'http://127.0.0.1:4567/fixture',
  pageDocumentToken:documentToken,startIndex:offset,totalItems:count,remainingItems:total-offset-count,
  items:Array.from({length:count},(_,i)=>({
   index:offset+i,scriptId:'script-'+(offset+i),path:'C:\\fixtures\\file'+(offset+i)+'.user.js',
   status:'dom-present' as const,checked:1,found:1,missing:0,needsReview:0,
   verification:{V0:'passed' as const,V1:'passed' as const,V2:'blocked' as const,
    V3:'not-configured' as const,V4:'not-configured' as const,highestVerified:'V1' as const,
    functionalVerified:false as const,managerVerified:false as const},
  })),
 };
};

test('cancel during CDP request cannot append a page to trusted memory or persisted SQLite journal',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'usshm-cancel-tx-'));
 const journal=openDiagnosisJournal(join(folder,'diagnosis.sqlite'));
 try{
  const gate=new DiagnosisRequestGate(),store=new BatchEvidenceStore();
  const commit=(ticket:ReturnType<DiagnosisRequestGate['begin']>,offset:number)=>{
   gate.assertCurrent(ticket);
   const data=page(offset);
   store.record({scanId,targetId,total:26,offset,page:data});
   journal.recordPage({scanId,targetId,total:26,offset,page:data});
   gate.complete(ticket,{pageItems:data.items.length,totalItems:26});
  };
  const first=gate.begin({scanId,targetId,offset:0});commit(first,0);
  const historyId=journal.listRecent()[0]!.runId;
  assert.equal(journal.listItems(historyId).length,25);
  const second=gate.begin({scanId,targetId,offset:25});
  let release!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  const late=waiting.then(()=>commit(second,25));
  // The Main cancellation IPC is delivered while Chrome is still waiting.
  gate.cancel({scanId,targetId});
  journal.cancel({scanId,targetId});
  release();
  await assert.rejects(late,/cancel|stale|revoked/i);
  assert.equal(store.snapshot({scanId,targetId}).report.items.length,25,
   'completed prefix remains exportable while cancelled page is not appended');
  assert.equal(journal.listItems(historyId).length,25);
  const interrupted=journal.listRecent().find(row=>row.runId===historyId)!;
  assert.equal(interrupted.status,'cancelled');
  assert.equal(interrupted.processedItems,25);
 }finally{journal.close();await rm(folder,{recursive:true,force:true});}
});

test('a stale failure after cancel and restart cannot clear the new batch evidence or journal run',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'usshm-restart-tx-'));
 const journal=openDiagnosisJournal(join(folder,'diagnosis.sqlite'));
 try{
  const gate=new DiagnosisRequestGate(),store=new BatchEvidenceStore();
  const old=gate.begin({scanId,targetId,offset:0});
  gate.cancel({scanId,targetId});journal.cancel({scanId,targetId});
  const latest=gate.begin({scanId,targetId,offset:0});
  const firstPage=page(0);
  gate.assertCurrent(latest);
  store.record({scanId,targetId,total:26,offset:0,page:firstPage});
  const newest=journal.recordPage({scanId,targetId,total:26,offset:0,page:firstPage});
  gate.complete(latest,{pageItems:25,totalItems:26});
  assert.equal(gate.failIfCurrent(old),false);
  assert.equal(store.snapshot({scanId,targetId}).report.items.length,25);
  assert.equal(journal.listRecent()[0]?.runId,newest.runId);
  assert.equal(journal.listRecent()[0]?.status,'running');
 }finally{journal.close();await rm(folder,{recursive:true,force:true});}
});
