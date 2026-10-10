import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDiagnosisJournal} from '../src/index.ts';
import type {PaginatedDomPage} from '../../scan-service/src/paginated-dom.ts';

const scanId='scan-private',targetId='page-internal';
const url='https://example.org/secret?token=do-not-persist#private';
function page(offset:number,total=26,token='a'.repeat(64)):PaginatedDomPage{
 const count=Math.min(25,total-offset);
 return {
  validationLevel:'dom-only',pageTargetId:targetId,pageUrl:url,
  pageDocumentToken:token,startIndex:offset,remainingItems:total-offset-count,totalItems:count,
  items:Array.from({length:count},(_,i)=>({
   index:offset+i,scriptId:'SECRET-user-script-name',path:'C:\\Users\\Private\\my-secret.user.js',
   status:'dom-present' as const,checked:1,found:1,missing:0,needsReview:0,
   verification:{V0:'passed' as const,V1:'passed' as const,V2:'blocked' as const,V3:'not-configured' as const,
    V4:'not-configured' as const,highestVerified:'V1' as const,functionalVerified:false as const,managerVerified:false as const},
  })),
 };
}
async function withJournal(work:(path:string)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'usshm-journal-'));
 try{await work(join(directory,'diagnosis-journal.sqlite'));}finally{await rm(directory,{recursive:true,force:true});}
}
test('persists ordered pages and their V1-only evidence across SQLite reopen without source paths',async()=>withJournal(async path=>{
 let journal=openDiagnosisJournal(path);
 const first=journal.recordPage({scanId,targetId,total:26,offset:0,page:page(0)});
 assert.equal(first.status,'running');
 assert.equal(first.processedItems,25);
 const done=journal.recordPage({scanId,targetId,total:26,offset:25,page:page(25)});
 assert.equal(done.status,'completed');
 assert.equal(done.processedItems,26);
 const id=done.runId;
 journal.close();
 journal=openDiagnosisJournal(path);
 const history=journal.listRecent();
 assert.equal(history.length,1);
 assert.equal(history[0]?.runId,id);
 assert.equal(history[0]?.status,'completed');
 assert.equal(history[0]?.pageOrigin,'https://example.org');
 assert.equal(history[0]?.totalItems,26);
 assert.equal(history[0]?.processedItems,26);
 assert.equal(journal.listItems(id).length,26);
 assert.equal(journal.listItems(id)[25]?.verificationV1,'passed');
 journal.close();
 const disk=await readFile(path);
 for(const secret of ['SECRET-user-script-name','do-not-persist','my-secret.user.js','Private','page-internal','scan-private','a'.repeat(64)])
  assert.equal(disk.includes(Buffer.from(secret)),false,secret);
}));
test('on restart a running scan is marked interrupted, never auto-resumed',async()=>withJournal(async path=>{
 let journal=openDiagnosisJournal(path);
 journal.recordPage({scanId,targetId,total:26,offset:0,page:page(0)});
 journal.close();
 journal=openDiagnosisJournal(path);
 const recent=journal.listRecent();
 assert.equal(recent[0]?.status,'interrupted');
 assert.equal(recent[0]?.processedItems,25);
 assert.throws(()=>journal.recordPage({scanId,targetId,total:26,offset:25,page:page(25)}),/new|first|missing|interrupted/i);
 journal.close();
}));
test('out-of-order/duplicate/stale documents are rejected without partial row insertion',async()=>withJournal(async path=>{
 const journal=openDiagnosisJournal(path);
 assert.throws(()=>journal.recordPage({scanId,targetId,total:26,offset:25,page:page(25)}),/first|order|offset/i);
 journal.recordPage({scanId,targetId,total:26,offset:0,page:page(0)});
 assert.throws(()=>journal.recordPage({scanId,targetId,total:26,offset:25,page:page(25,26,'b'.repeat(64))}),/document|identity/i);
 assert.equal(journal.listRecent()[0]?.processedItems,25);
 assert.equal(journal.listItems(journal.listRecent()[0]!.runId).length,25);
 assert.throws(()=>journal.recordPage({scanId,targetId,total:26,offset:0,page:{...page(0),remainingItems:100}}),/partial|count|remaining|invalid/i);
 journal.close();
}));
test('cancelling one session is durable and does not affect another scan',async()=>withJournal(async path=>{
 const journal=openDiagnosisJournal(path);
 journal.recordPage({scanId,targetId,total:26,offset:0,page:page(0)});
 const other=journal.recordPage({scanId:'another',targetId,total:26,offset:0,page:page(0)});
 journal.cancel({scanId,targetId});
 const history=journal.listRecent();
 assert.equal(history.find(x=>x.runId===other.runId)?.status,'running');
 assert.equal(history.find(x=>x.runId!==other.runId)?.status,'cancelled');
 assert.throws(()=>journal.recordPage({scanId,targetId,total:26,offset:25,page:page(25)}),/first|cancelled|running|missing/i);
 journal.close();
}));
test('future journal schema version is rejected without destructive downgrade',async()=>withJournal(async path=>{
 const db=new DatabaseSync(path);
 db.exec('PRAGMA user_version=9');
 db.close();
 assert.throws(()=>openDiagnosisJournal(path),/unsupported|schema|version/i);
 const check=new DatabaseSync(path);
 assert.equal((check.prepare('PRAGMA user_version').get() as {user_version:number}).user_version,9);
 check.close();
}));

test('starting a fresh static scan can mark every abandoned live history entry interrupted without data loss',async()=>withJournal(async path=>{
 const journal=openDiagnosisJournal(path);
 const old=journal.recordPage({scanId,targetId,total:26,offset:0,page:page(0)});
 const other=journal.recordPage({scanId:'other',targetId,total:26,offset:0,page:page(0)});
 journal.interruptRunning();
 const rows=journal.listRecent();
 assert.equal(rows.find(x=>x.runId===old.runId)?.status,'interrupted');
 assert.equal(rows.find(x=>x.runId===other.runId)?.status,'interrupted');
 assert.equal(journal.listItems(old.runId).length,25);
 journal.close();
}));


test('diagnosis journal rejects contradictory per-item totals and status before any SQLite write',async()=>withJournal(async path=>{
 const journal=openDiagnosisJournal(path);
 try{
  const baseline=page(0,1);
  const contradictions=[
   {status:'needs-review' as const,checked:1,found:1,missing:1,needsReview:0},
   {status:'needs-review' as const,checked:2,found:1,missing:0,needsReview:0},
   {status:'locator-missing' as const,checked:1,found:1,missing:0,needsReview:0},
   {status:'dom-present' as const,checked:1,found:0,missing:0,needsReview:1},
  ];
  for(const bad of contradictions){
   const row={...baseline.items[0]!,...bad,
    verification:{...baseline.items[0]!.verification,
     V1:'blocked' as const,highestVerified:'V0' as const}};
   const corrupted={...baseline,items:[row]};
   assert.throws(()=>journal.recordPage({
    scanId,targetId,total:1,offset:0,page:corrupted,
   }),/invalid|count|status|evidence|contradict/i,
   'refuse contradictory evidence: '+JSON.stringify(bad));
   assert.equal(journal.listRecent().length,0,'an invalid page must leave no persisted run');
  }
 }finally{journal.close();}
}));


test('uninspected dynamic or iframe locators remain valid review-only journal evidence',async()=>withJournal(async path=>{
 const journal=openDiagnosisJournal(path);
 try{
  const baseline=page(0,1);
  for(const pending of [1,3,50]){
   const row={...baseline.items[0]!,status:'needs-review' as const,
    checked:0,found:0,missing:0,needsReview:pending,
    verification:{...baseline.items[0]!.verification,
     V1:'blocked' as const,highestVerified:'V0' as const}};
   const result=journal.recordPage({
    scanId,targetId,total:1,offset:0,
    page:{...baseline,items:[row]},
   });
   assert.equal(result.status,'completed');
   assert.equal(journal.listItems(result.runId)[0]?.needsReview,pending);
  }
 }finally{journal.close();}
}));


test('consistent journal backup includes committed WAL rows, integrity and SHA-256 without replacing previous backups',async()=>withJournal(async path=>{
 const journal=openDiagnosisJournal(path);
 try{
  const snapshot=(journal as unknown as {backupSnapshot?:(destination:string)=>Promise<{path:string;sha256:string;bytes:number}>}).backupSnapshot;
  assert.equal(typeof snapshot,'function','journal backup API must be present');
  const destination=join(path,'..','history-backup.sqlite');
  const expected=journal.recordPage({scanId,targetId,total:1,offset:0,page:page(0,1)});
  const output=await snapshot!(destination);
  assert.equal(output.path,destination);
  assert.match(output.sha256,/^[a-f0-9]{64}$/);
  assert.ok(output.bytes>512);
  const backupDb=new DatabaseSync(destination,{readOnly:true});
  try{
   assert.equal(backupDb.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
   assert.equal(backupDb.prepare('PRAGMA user_version').get()?.user_version,1);
   assert.equal(backupDb.prepare('SELECT run_id FROM journal_runs LIMIT 1').get()?.run_id,expected.runId);
   assert.equal(backupDb.prepare('SELECT COUNT(*) AS c FROM journal_items').get()?.c,1);
  }finally{backupDb.close();}
  const {createHash}=await import('node:crypto');
  assert.equal(createHash('sha256').update(await readFile(destination)).digest('hex'),output.sha256);
  await assert.rejects(snapshot!(destination),/exist|overwrite|already|refus/i);
  await assert.rejects(snapshot!('relative.sqlite'),/absolute|invalid|destination/i);
  assert.equal(journal.listRecent()[0]?.runId,expected.runId);
 }finally{journal.close();}
}));
