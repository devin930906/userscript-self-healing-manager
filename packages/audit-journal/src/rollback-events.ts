import {DatabaseSync} from 'node:sqlite';
import {assertSafeAuditJournalPath} from './index.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const SCRIPT=/^[A-Za-z0-9_-]{1,64}$/;
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
type Outcome='committed'|'uncertain';
export type RollbackIntent=Readonly<{id:string;scriptId:string;previousHash:string|null;targetHash:string;
 sourceAuditRevisionId:string|null;targetAuditRevisionId:string|null;at:string}>;
export type RollbackEvent=Readonly<Omit<RollbackIntent,'at'> & {createdAt:string;outcome:Outcome|null;finishedAt:string|null}>;
const validTime=(s:string)=>typeof s==='string'&&ISO.test(s)&&Number.isFinite(Date.parse(s))&&
 new Date(Date.parse(s)).toISOString()===s;
const maybeUUID=(s:string|null)=>s===null||(typeof s==='string'&&UUID.test(s));
function validate(v:RollbackIntent):void{
 if(!v||typeof v!=='object'||!UUID.test(v.id)||!SCRIPT.test(v.scriptId)||
    (v.previousHash!==null&&(typeof v.previousHash!=='string'||!SHA.test(v.previousHash)))||
    typeof v.targetHash!=='string'||!SHA.test(v.targetHash)||
    !maybeUUID(v.sourceAuditRevisionId)||!maybeUUID(v.targetAuditRevisionId)||!validTime(v.at))
  throw new Error('Invalid durable rollback audit intent');
 if(v.previousHash===v.targetHash)throw new Error('Rollback source and target are identical');
}
const tables={
 rollback_intents:'CREATE TABLE rollback_intents(id TEXT PRIMARY KEY,script_id TEXT NOT NULL,previous_hash TEXT,target_hash TEXT NOT NULL,source_revision_id TEXT,target_revision_id TEXT,created_at TEXT NOT NULL)',
 rollback_outcomes:"CREATE TABLE rollback_outcomes(intent_id TEXT PRIMARY KEY REFERENCES rollback_intents(id),outcome TEXT NOT NULL CHECK(outcome IN ('committed','uncertain')),target_hash TEXT NOT NULL,finished_at TEXT NOT NULL)",
} as const;
const trigger=(name:string,action:'UPDATE'|'DELETE')=>
 'CREATE TRIGGER '+name+'_no_'+action.toLowerCase()+' BEFORE '+action+' ON '+name+
 " BEGIN SELECT RAISE(ABORT,'rollback audit is append-only'); END";
const normalize=(s:string)=>s.replace(/\s+/g,' ').trim().replace(/;$/,'');
function verify(db:DatabaseSync):void{
 if((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version!==1)
  throw new Error('Unsupported rollback audit schema');
 for(const [name,definition] of Object.entries(tables)){
  const t=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(name) as {type:string;sql:string}|undefined;
  if(t?.type!=='table'||!t.sql||normalize(t.sql)!==normalize(definition))
   throw new Error('Invalid rollback audit table schema');
  for(const action of ['UPDATE','DELETE'] as const){
   const expected=trigger(name,action),key=name+'_no_'+action.toLowerCase();
   const row=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(key) as {type:string;sql:string}|undefined;
   if(row?.type!=='trigger'||!row.sql||normalize(row.sql)!==normalize(expected))
    throw new Error('Invalid rollback audit append-only trigger');
  }
 }
 const result=db.prepare('PRAGMA quick_check').get() as Record<string,unknown>|undefined;
 if(!result||Object.values(result)[0]!=='ok')throw new Error('Corrupt rollback audit SQLite journal');
}

/** Immutable FR-041 rollback intent BEFORE write + outcome AFTER verification.
 * This is a separate operation ledger; it does not pretend that a manual
 * rollback passed a new six-stage repair test. Missing prior audit links remain
 * NULL rather than being invented. No code, DOM, path, URL or secrets stored.
 */
export function openRollbackAuditJournal(file:string){
 assertSafeAuditJournalPath(file);
 const db=new DatabaseSync(file);
 try{
  const version=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
  if(version!==0&&version!==1)throw new Error('Unsupported rollback audit schema');
  db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;');
  if(version===0){
   db.exec('BEGIN IMMEDIATE;');
   try{
    for(const [name,statement] of Object.entries(tables)){
     db.exec(statement+';');
     for(const action of ['UPDATE','DELETE'] as const)db.exec(trigger(name,action)+';');
    }
    db.exec('PRAGMA user_version=1;COMMIT;');
   }catch{try{db.exec('ROLLBACK;')}catch{}throw new Error('Failed to initialize rollback audit journal');}
  }
  verify(db);
 }catch(error){db.close();throw error;}
 const lookup=db.prepare('SELECT i.id,i.script_id,i.previous_hash,i.target_hash,i.source_revision_id,i.target_revision_id,i.created_at,o.outcome,o.finished_at FROM rollback_intents i LEFT JOIN rollback_outcomes o ON i.id=o.intent_id WHERE i.id=?');
 const unfinished=db.prepare('SELECT i.id FROM rollback_intents i LEFT JOIN rollback_outcomes o ON o.intent_id=i.id WHERE i.script_id=? AND o.intent_id IS NULL LIMIT 1');
 const insert=db.prepare('INSERT INTO rollback_intents(id,script_id,previous_hash,target_hash,source_revision_id,target_revision_id,created_at) VALUES(?,?,?,?,?,?,?)');
 const mark=db.prepare('INSERT INTO rollback_outcomes(intent_id,outcome,target_hash,finished_at) VALUES(?,?,?,?)');
 function get(id:string):RollbackEvent|null{
  if(typeof id!=='string'||!UUID.test(id))throw new Error('Invalid rollback audit ID');
  const row=lookup.get(id) as Record<string,unknown>|undefined;
  if(!row)return null;
  const record:RollbackEvent=Object.freeze({
   id:String(row.id),scriptId:String(row.script_id),
   previousHash:row.previous_hash===null?null:String(row.previous_hash),
   targetHash:String(row.target_hash),
   sourceAuditRevisionId:row.source_revision_id===null?null:String(row.source_revision_id),
   targetAuditRevisionId:row.target_revision_id===null?null:String(row.target_revision_id),
   createdAt:String(row.created_at),outcome:row.outcome===null?null:row.outcome as Outcome,
   finishedAt:row.finished_at===null?null:String(row.finished_at),
  });
  validate({...record,at:record.createdAt});
  if((record.outcome!==null&&record.outcome!=='committed'&&record.outcome!=='uncertain')||
     (record.outcome===null)!==(record.finishedAt===null)||
     (record.finishedAt!==null&&!validTime(record.finishedAt)))
   throw new Error('Corrupt rollback audit outcome');
  return record;
 }
 return Object.freeze({
  begin(input:RollbackIntent):void{
   validate(input);
   try{
    db.exec('BEGIN IMMEDIATE;');
    if(unfinished.get(input.scriptId))throw new Error('Unresolved rollback audit intent');
    insert.run(input.id,input.scriptId,input.previousHash,input.targetHash,
     input.sourceAuditRevisionId,input.targetAuditRevisionId,input.at);
    db.exec('COMMIT;');
   }catch{
    try{db.exec('ROLLBACK;')}catch{}
    throw new Error('Rollback audit intent unavailable or pending; manual review required');
   }
  },
  finish(input:{id:string;outcome:Outcome;targetHash:string;at:string}):void{
   if(!input||typeof input.id!=='string'||!UUID.test(input.id)||
      (input.outcome!=='committed'&&input.outcome!=='uncertain')||
      typeof input.targetHash!=='string'||!SHA.test(input.targetHash)||!validTime(input.at))
    throw new Error('Invalid rollback audit completion');
   const old=get(input.id);
   if(!old||old.targetHash!==input.targetHash)
    throw new Error('Rollback audit target mismatch or missing intent');
   if(old.outcome!==null)throw new Error('Rollback audit outcome already recorded');
   try{mark.run(input.id,input.outcome,input.targetHash,input.at);}
   catch{throw new Error('Rollback audit outcome persistence failed; manual review required');}
  },
  get,close:():void=>db.close(),
 });
}
