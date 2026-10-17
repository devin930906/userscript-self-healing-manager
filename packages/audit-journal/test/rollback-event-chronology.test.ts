import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openRollbackAuditJournal} from '../src/rollback-events.ts';

const ID='00000000-0000-4000-8000-000000000001';
const BEFORE='2026-10-17T06:59:59.999Z';
const START='2026-10-17T07:00:00.000Z';
const AFTER='2026-10-17T07:00:00.001Z';
const HASH_A='a'.repeat(64),HASH_B='b'.repeat(64);

async function withJournal(run:(file:string)=>Promise<void>):Promise<void>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-chronology-'));
 try{await run(join(root,'rollback-events.sqlite'));}
 finally{await rm(root,{recursive:true,force:true});}
}
function begin(file:string):void{
 const journal=openRollbackAuditJournal(file);
 try{
  journal.begin({id:ID,scriptId:'synthetic_script',previousHash:HASH_A,targetHash:HASH_B,
   sourceAuditRevisionId:null,targetAuditRevisionId:null,at:START});
 }finally{journal.close();}
}

test('RG-06 rollback audit refuses completion earlier than its durable intent',async()=>withJournal(async file=>{
 begin(file);
 const journal=openRollbackAuditJournal(file);
 try{
  assert.throws(()=>journal.finish({id:ID,outcome:'committed',targetHash:HASH_B,at:BEFORE}),
   /before|earlier|chronolog|time/i,
   'a chronologically impossible completion must never be committed');
  assert.equal(journal.get(ID)?.outcome,null,'failed completion leaves the intent unresolved');
  journal.finish({id:ID,outcome:'committed',targetHash:HASH_B,at:AFTER});
  assert.equal(journal.get(ID)?.finishedAt,AFTER,'later genuine outcome remains allowed');
 }finally{journal.close();}
}));

test('RG-06 rollback audit rejects persisted out-of-order outcomes on reopen',async()=>withJournal(async file=>{
 begin(file);
 const raw=new DatabaseSync(file);
 try{
  raw.prepare('INSERT INTO rollback_outcomes(intent_id,outcome,target_hash,finished_at) VALUES(?,?,?,?)')
   .run(ID,'committed',HASH_B,BEFORE);
 }finally{raw.close();}
 const journal=openRollbackAuditJournal(file);
 try{
  assert.throws(()=>journal.get(ID),/corrupt|chronolog|timestamp|order/i,
   'a previously persisted invalid event must not be returned as verified history');
  assert.throws(()=>journal.listByScript('synthetic_script'),/corrupt|chronolog|timestamp|order/i);
 }finally{journal.close();}
}));
