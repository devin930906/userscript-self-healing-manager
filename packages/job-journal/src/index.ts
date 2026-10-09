import {randomUUID,createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {PaginatedDomPage} from '../../scan-service/src/paginated-dom.ts';

export type JournalState='running'|'completed'|'cancelled'|'interrupted'|'failed';
export interface JournalRun {
 readonly runId:string;readonly status:JournalState;
 readonly pageOrigin:string;readonly totalItems:number;readonly processedItems:number;
 readonly domPresent:number;readonly locatorMissing:number;readonly needsReview:number;readonly errors:number;
 readonly startedAt:string;readonly updatedAt:string;
}
export interface JournalItem {
 readonly index:number;readonly status:string;readonly checked:number;readonly found:number;
 readonly missing:number;readonly needsReview:number;
 readonly verificationV0:string;readonly verificationV1:string;
}
const states=new Set(['dom-present','locator-missing','needs-review','out-of-scope','skipped','error','no-evidence']);
const verificationStates=new Set(['passed','failed','skipped','blocked','not-configured']);
const keyOf=(scanId:string,targetId:string):string=>{
 if(typeof scanId!=='string'||scanId.length<1||scanId.length>128||
    typeof targetId!=='string'||targetId.length<1||targetId.length>128)
  throw new Error('Invalid diagnosis session identity');
 return createHash('sha256').update(JSON.stringify([scanId,targetId])).digest('hex');
};
const asRun=(row:unknown):JournalRun=>{
 if(!row)throw new Error('Diagnosis run missing');
 const x=row as Record<string,unknown>;
 return {
  runId:String(x.runId),status:x.status as JournalState,pageOrigin:String(x.pageOrigin),
  totalItems:Number(x.totalItems),processedItems:Number(x.processedItems),
  domPresent:Number(x.domPresent),locatorMissing:Number(x.locatorMissing),
  needsReview:Number(x.needsReview),errors:Number(x.errors),
  startedAt:String(x.startedAt),updatedAt:String(x.updatedAt),
 };
};
function originOf(url:string):string{
 let parsed:URL;
 try{parsed=new URL(url);}catch{throw new Error('Invalid diagnosis URL');}
 if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)
  throw new Error('Invalid diagnosis URL origin');
 return parsed.origin;
}
/** Opens a separate, local-only database; never mutates the script registry database. */
export function openDiagnosisJournal(file:string){
 if(!isAbsolute(file))throw new Error('Diagnosis journal path must be absolute');
 const db=new DatabaseSync(file);
 try{
  const v=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
  if(v!==0&&v!==1)throw new Error('Unsupported diagnosis journal schema version');
  db.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;');
  if(v===0){
   try{
    db.exec('BEGIN IMMEDIATE');
    db.exec([
     'CREATE TABLE journal_runs (',
     'run_id TEXT PRIMARY KEY,session_key TEXT NOT NULL,page_origin TEXT NOT NULL,document_key TEXT NOT NULL,',
     'total_items INTEGER NOT NULL,processed_items INTEGER NOT NULL DEFAULT 0,',
     'dom_present INTEGER NOT NULL DEFAULT 0,locator_missing INTEGER NOT NULL DEFAULT 0,',
     'needs_review INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,',
     "status TEXT NOT NULL CHECK(status IN ('running','completed','cancelled','interrupted','failed')),",
     'started_at TEXT NOT NULL,updated_at TEXT NOT NULL);',
     'CREATE INDEX journal_runs_recent ON journal_runs(started_at DESC);',
     'CREATE INDEX journal_runs_session ON journal_runs(session_key,status);',
     'CREATE TABLE journal_items (',
     'run_id TEXT NOT NULL REFERENCES journal_runs(run_id) ON DELETE CASCADE,',
     'item_index INTEGER NOT NULL,status TEXT NOT NULL,checked INTEGER NOT NULL,',
     'found INTEGER NOT NULL,missing INTEGER NOT NULL,needs_review INTEGER NOT NULL,',
     'verification_v0 TEXT NOT NULL,verification_v1 TEXT NOT NULL,',
     'PRIMARY KEY(run_id,item_index));',
     'PRAGMA user_version=1;',
    ].join('\n'));
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
  // An obsolete browser session must never be silently resumed on startup.
  db.prepare("UPDATE journal_runs SET status='interrupted',updated_at=? WHERE status='running'")
   .run(new Date().toISOString());
 }catch(error){db.close();throw error;}
 const getRun=db.prepare('SELECT run_id AS runId,status,page_origin AS pageOrigin,total_items AS totalItems,'+
  'processed_items AS processedItems,dom_present AS domPresent,locator_missing AS locatorMissing,'+
  'needs_review AS needsReview,errors,started_at AS startedAt,updated_at AS updatedAt FROM journal_runs WHERE run_id=?');
 const active=db.prepare("SELECT run_id AS runId,document_key AS documentKey,page_origin AS pageOrigin,"+
  "total_items AS totalItems,processed_items AS processedItems FROM journal_runs WHERE session_key=? AND status='running' ORDER BY rowid DESC LIMIT 1");
 const insertRun=db.prepare("INSERT INTO journal_runs(run_id,session_key,page_origin,document_key,total_items,status,started_at,updated_at) VALUES(?,?,?,?,?,'running',?,?)");
 const insertItem=db.prepare('INSERT INTO journal_items(run_id,item_index,status,checked,found,missing,needs_review,verification_v0,verification_v1) VALUES(?,?,?,?,?,?,?,?,?)');
 const progress=db.prepare('UPDATE journal_runs SET processed_items=?,dom_present=dom_present+?,'+
  'locator_missing=locator_missing+?,needs_review=needs_review+?,errors=errors+?,status=?,updated_at=? WHERE run_id=?');
 const listRuns=db.prepare('SELECT run_id AS runId,status,page_origin AS pageOrigin,total_items AS totalItems,'+
  'processed_items AS processedItems,dom_present AS domPresent,locator_missing AS locatorMissing,'+
  'needs_review AS needsReview,errors,started_at AS startedAt,updated_at AS updatedAt FROM journal_runs ORDER BY started_at DESC,rowid DESC LIMIT ?');
 const listRows=db.prepare('SELECT item_index AS "index",status,checked,found,missing,needs_review AS needsReview,'+
  'verification_v0 AS verificationV0,verification_v1 AS verificationV1 FROM journal_items WHERE run_id=? ORDER BY item_index');
 return {
  recordPage({scanId,targetId,total,offset,page}:{
   scanId:string;targetId:string;total:number;offset:number;page:PaginatedDomPage;
  }):JournalRun{
   const key=keyOf(scanId,targetId);
   if(!Number.isSafeInteger(total)||total<1||total>1000||
      !Number.isSafeInteger(offset)||offset<0||offset>=total||offset%25!==0)
    throw new Error('Invalid diagnosis page offset or total');
   const size=Math.min(25,total-offset);
   if(page?.validationLevel!=='dom-only'||page.pageTargetId!==targetId||
      page.startIndex!==offset||page.totalItems!==size||
      page.remainingItems!==total-offset-size||
      !Array.isArray(page.items)||page.items.length!==size||
      !page.pageDocumentToken||!/^[0-9a-f]{64}$/.test(page.pageDocumentToken))
    throw new Error('Invalid or partial CDP diagnosis page');
   const pageOrigin=originOf(page.pageUrl);
   const documentKey=createHash('sha256').update(page.pageDocumentToken).digest('hex');
   for(let i=0;i<size;i++){
    const row=page.items[i]!;
    const v=row?.verification;
    if(!row||row.index!==offset+i||!states.has(row.status)||!v||
       !verificationStates.has(v.V0)||!verificationStates.has(v.V1)||
       v.V2!=='blocked'||v.V3!=='not-configured'||v.V4!=='not-configured'||
       v.functionalVerified!==false||v.managerVerified!==false)
     throw new Error('Invalid diagnosis item identity or verification grade');
    for(const count of [row.checked,row.found,row.missing,row.needsReview]){
     if(!Number.isSafeInteger(count)||count<0||count>10000)throw new Error('Invalid diagnosis item counts');
    }
    if(row.checked>50||row.found>row.checked||row.missing>row.checked)
     throw new Error('Invalid diagnosis checked count');
    if(v.V1==='passed'&&(row.status!=='dom-present'||row.checked===0||
       row.found!==row.checked||row.missing!==0||row.needsReview!==0))
     throw new Error('Unverified DOM status cannot claim V1 passed');
   }
   const now=new Date().toISOString();
   let runId:string;
   try{
    db.exec('BEGIN IMMEDIATE');
    if(offset===0){
     db.prepare("UPDATE journal_runs SET status='interrupted',updated_at=? WHERE session_key=? AND status='running'").run(now,key);
     runId=randomUUID();
     insertRun.run(runId,key,pageOrigin,documentKey,total,now,now);
    }else{
     const current=active.get(key) as {runId:string;documentKey:string;pageOrigin:string;totalItems:number;processedItems:number}|undefined;
     if(!current||current.processedItems!==offset)throw new Error('Missing or out-of-order running diagnosis page');
     if(current.documentKey!==documentKey||current.pageOrigin!==pageOrigin||current.totalItems!==total)
      throw new Error('CDP document identity changed during persistent diagnosis');
     runId=current.runId;
    }
    let present=0,missing=0,review=0,errors=0;
    for(const row of page.items){
     const v=row.verification!;
     insertItem.run(runId,row.index,row.status,row.checked,row.found,row.missing,row.needsReview,v.V0,v.V1);
     if(row.status==='dom-present')present++;
     if(row.status==='locator-missing')missing++;
     if(row.status==='needs-review')review++;
     if(row.status==='error')errors++;
    }
    progress.run(offset+size,present,missing,review,errors,offset+size===total?'completed':'running',now,runId);
    // Bound long-term local telemetry to the latest 200 runs.
    db.exec('DELETE FROM journal_runs WHERE run_id IN (SELECT run_id FROM journal_runs ORDER BY started_at DESC,rowid DESC LIMIT -1 OFFSET 200)');
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   return asRun(getRun.get(runId!));
  },
  currentRunId({scanId,targetId}:{scanId:string;targetId:string}):string|null{
   const row=active.get(keyOf(scanId,targetId)) as {runId:string}|undefined;
   return row?.runId??null;
  },
  failIfCurrent({scanId,targetId,runId}:{scanId:string;targetId:string;runId:string|null}):void{
   if(!runId)return;
   db.prepare("UPDATE journal_runs SET status='failed',updated_at=? WHERE session_key=? AND run_id=? AND status='running'")
    .run(new Date().toISOString(),keyOf(scanId,targetId),runId);
  },
  cancel({scanId,targetId}:{scanId:string;targetId:string}):void{
   db.prepare("UPDATE journal_runs SET status='cancelled',updated_at=? WHERE session_key=? AND status='running'")
    .run(new Date().toISOString(),keyOf(scanId,targetId));
  },
  listRecent(limit=20):JournalRun[]{
   if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid journal listing limit');
   return (listRuns.all(limit) as unknown[]).map(asRun);
  },
  listItems(runId:string):JournalItem[]{
   if(!/^[0-9a-f-]{36}$/i.test(runId))throw new Error('Invalid journal run id');
   return listRows.all(runId) as unknown as JournalItem[];
  },
  close():void{db.close();},
 };
}
export type DiagnosisJournal=ReturnType<typeof openDiagnosisJournal>;
