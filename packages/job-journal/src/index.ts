import {randomUUID,createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {backupVerifiedSqliteSnapshot} from '../../persistence/src/index.ts';
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
/**
 * Shared v1 journal schema gate for startup, new snapshot publication and
 * independent core recovery audit. A well-formed SQLite file and matching
 * unkeyed manifest hash do not prove the expected table/constraint layout.
 */
export function assertJournalSchemaSafety(db:DatabaseSync):void{
 const expected:Record<string,readonly (readonly [string,string,number,number])[]>={
  journal_runs:[
   ['run_id','TEXT',0,1],['session_key','TEXT',1,0],
   ['page_origin','TEXT',1,0],['document_key','TEXT',1,0],
   ['total_items','INTEGER',1,0],['processed_items','INTEGER',1,0],
   ['dom_present','INTEGER',1,0],['locator_missing','INTEGER',1,0],
   ['needs_review','INTEGER',1,0],['errors','INTEGER',1,0],
   ['status','TEXT',1,0],['started_at','TEXT',1,0],
   ['updated_at','TEXT',1,0],
  ],
  journal_items:[
   ['run_id','TEXT',1,1],['item_index','INTEGER',1,2],
   ['status','TEXT',1,0],['checked','INTEGER',1,0],
   ['found','INTEGER',1,0],['missing','INTEGER',1,0],
   ['needs_review','INTEGER',1,0],['verification_v0','TEXT',1,0],
   ['verification_v1','TEXT',1,0],
  ],
 };
 for(const [name,columns] of Object.entries(expected)){
  const row=db.prepare("SELECT type FROM sqlite_master WHERE name=? LIMIT 1").get(name) as {type?:string}|undefined;
  if(row?.type!=='table')throw new Error('Missing diagnosis journal schema table');
  // Names below are code-owned constants, not imported data or SQL parameters.
  const actual=db.prepare(`PRAGMA table_info(${name})`).all() as {
   name:string;type:string;notnull:number;pk:number;
  }[];
  if(actual.length!==columns.length||actual.some((c,i)=>{
   const expectedColumn=columns[i]!;
   return c.name!==expectedColumn[0]||c.type.toUpperCase()!==expectedColumn[1]||
     c.notnull!==expectedColumn[2]||c.pk!==expectedColumn[3];
  }))throw new Error('Incompatible diagnosis journal schema columns');
 }
 const foreignKeys=db.prepare('PRAGMA foreign_key_list(journal_items)').all() as {
  table:string;from:string;to:string;on_delete:string;
 }[];
 if(foreignKeys.length!==1||foreignKeys[0]?.table!=='journal_runs'||
    foreignKeys[0]?.from!=='run_id'||foreignKeys[0]?.to!=='run_id'||
    foreignKeys[0]?.on_delete!=='CASCADE')
  throw new Error('Incompatible diagnosis journal foreign key schema');
 const trigger=db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('journal_runs','journal_items') LIMIT 1").get();
 if(trigger)throw new Error('Unsafe diagnosis journal schema: unrecognized trigger');
}
/** Opens a separate, local-only database; never mutates the script registry database. */
export function openDiagnosisJournal(file:string){
 if(!isAbsolute(file))throw new Error('Diagnosis journal path must be absolute');
 const db=new DatabaseSync(file);
 try{
  const v=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
  if(v!==0&&v!==1)throw new Error('Unsupported diagnosis journal schema version');
  if(v===1)assertJournalSchemaSafety(db);
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
  assertJournalSchemaSafety(db);
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
    // When scope is unknown or every locator requires runtime context,
    // the batch records pending review candidates without probing the DOM.
    // Such a row legitimately has checked=0 and needsReview>0. Once any
    // locator was probed, the observed outcomes must partition checked.
    const uncheckedReview=row.checked===0&&row.found===0&&row.missing===0&&
      row.status==='needs-review'&&row.needsReview>0;
    if(row.checked>50||(!uncheckedReview&&
       row.found+row.missing+row.needsReview!==row.checked))
     throw new Error('Invalid or contradictory diagnosis checked counts');
    // Persisted trends cannot rely on a label contradicted by its evidence.
    if(row.status==='dom-present'&&(row.checked===0||row.found!==row.checked||
       row.missing!==0||row.needsReview!==0))
     throw new Error('Contradictory DOM-present diagnosis status');
    if(row.status==='locator-missing'&&row.missing===0)
     throw new Error('Contradictory missing-locator diagnosis status');
    if(v.V1==='passed'&&(row.status!=='dom-present'||row.checked===0||
       row.found!==row.checked||row.missing!==0||row.needsReview!==0))
     throw new Error('Unverified DOM status cannot claim V1 passed');
    // Persisted evidence must enforce the same bidirectional V1 gate as
    // JSON/Markdown export: an inconclusive result is never a verified fail.
    if(v.V1==='failed'&&(row.status!=='locator-missing'||row.checked<1||row.missing<1))
     throw new Error('Unverified diagnosis cannot claim V1 failed');
    if(v.V1==='skipped'&&row.status!=='skipped'&&row.status!=='out-of-scope')
     throw new Error('Unverified diagnosis cannot claim V1 skipped');
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
  interruptRunning():void{
   db.prepare("UPDATE journal_runs SET status='interrupted',updated_at=? WHERE status='running'")
    .run(new Date().toISOString());
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
  /** Consistent, read-only journal export. Never auto-restore or write to original scripts. */
  backupSnapshot(destination:string):Promise<{path:string;sha256:string;bytes:number}>{
   return backupVerifiedSqliteSnapshot(db,destination,copy=>{
    const version=(copy.prepare('PRAGMA user_version').get() as {user_version:unknown}).user_version;
    if(version!==1)throw new Error('Unsupported diagnosis journal backup version');
    for(const table of ['journal_runs','journal_items']){
     const exists=copy.prepare("SELECT type FROM sqlite_master WHERE name=?").get(table) as {type?:string}|undefined;
     if(exists?.type!=='table')throw new Error('Incomplete diagnosis journal backup schema');
    }
    assertJournalSchemaSafety(copy);
    const problems=copy.prepare('PRAGMA foreign_key_check').all();
    if(problems.length)throw new Error('Diagnosis journal backup foreign key mismatch');
   });
  },
  close():void{db.close();},
 };
}
export type DiagnosisJournal=ReturnType<typeof openDiagnosisJournal>;
