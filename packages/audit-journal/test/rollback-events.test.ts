import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openRollbackAuditJournal} from '../src/rollback-events.ts';
import {executeAuditedManagedRollback} from '../../../apps/desktop/src/main/audited-managed-rollback.ts';
const ID=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),NOW='2026-10-17T07:00:00.000Z';
const intent=(n=1)=>({id:ID(n),scriptId:'synthetic_script',previousHash:A,targetHash:B,
 sourceAuditRevisionId:ID(5),targetAuditRevisionId:null});

test('FR-041 rollback journal durably records immutable intent before write and verified completion after restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-audit-'));
 try{
  const file=join(root,'rollback-events.sqlite');
  let journal=openRollbackAuditJournal(file);
  const calls:string[]=[];
  const result=await executeAuditedManagedRollback({
   journal,scriptId:'synthetic_script',targetHash:B,expectedCurrentHash:A,
   sourceAuditRevisionId:ID(5),targetAuditRevisionId:null,
   newId:()=>ID(1),now:()=>NOW,
   restore:async expected=>{
    calls.push('write');
    assert.equal(expected,A);
    const pending=journal.get(ID(1));
    assert.equal(pending?.outcome,null,'intent must be durable before activation');
    assert.equal(pending?.previousHash,A);
    assert.equal(pending?.sourceAuditRevisionId,ID(5));
    return {hash:B,activePath:'synthetic-current'};
   },
  });
  assert.equal(result.hash,B);assert.deepEqual(calls,['write']);
  assert.equal(journal.get(ID(1))?.outcome,'committed');
  journal.close();
  journal=openRollbackAuditJournal(file);
  assert.deepEqual(journal.get(ID(1)),{
   ...intent(),createdAt:NOW,outcome:'committed',finishedAt:NOW,
  });
  assert.throws(()=>journal.finish({id:ID(1),outcome:'committed',targetHash:B,at:NOW}),/already|duplicate/i);
  journal.close();
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-041 unfinished intent survives crash and blocks another rollback for same script without invented success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-audit-'));
 try{
  const file=join(root,'rollback-events.sqlite');
  let journal=openRollbackAuditJournal(file);
  journal.begin({...intent(),at:NOW});
  journal.close();journal=openRollbackAuditJournal(file);
  assert.equal(journal.get(ID(1))?.outcome,null);
  assert.throws(()=>journal.begin({...intent(2),at:NOW}),/pending|unresolved|review|incomplete/i);
  assert.equal(journal.get(ID(2)),null);
  journal.close();
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-041 invalid or duplicated audit identity fails before touching managed bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-audit-'));
 try{
  const journal=openRollbackAuditJournal(join(root,'rollback-events.sqlite'));
  let writes=0;
  await assert.rejects(executeAuditedManagedRollback({
   journal,scriptId:'../other',targetHash:B,expectedCurrentHash:A,
   newId:()=>ID(1),now:()=>NOW,
   restore:async()=>{writes++;return {hash:B,activePath:'synthetic'};},
  }),/invalid|unsafe/i);
  assert.equal(writes,0);
  journal.begin({...intent(),at:NOW});
  assert.throws(()=>journal.begin({...intent(2),scriptId:'different',previousHash:'bad',at:NOW}),/invalid|hash/i);
  assert.throws(()=>journal.finish({id:ID(1),outcome:'committed',targetHash:C,at:NOW}),/target|mismatch/i);
  assert.equal(journal.get(ID(1))?.outcome,null);
  journal.close();
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-041 uncertain failed activation leaves durable non-success event without leaking exception text',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-audit-'));
 try{
  const file=join(root,'rollback-events.sqlite');
  const journal=openRollbackAuditJournal(file);
  await assert.rejects(executeAuditedManagedRollback({
   journal,scriptId:'synthetic_script',targetHash:B,expectedCurrentHash:A,
   newId:()=>ID(1),now:()=>NOW,
   restore:async()=>{throw Error('secret-user-data-DO-NOT-LOG');},
  }),/uncertain|review/i);
  assert.equal(journal.get(ID(1))?.outcome,'uncertain');
  journal.close();
  const bytes=await readFile(file);
  assert.equal(bytes.includes(Buffer.from('secret-user-data-DO-NOT-LOG')),false);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-041 mismatched activation receipt cannot be filed as successful rollback',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-audit-'));
 try{
  const journal=openRollbackAuditJournal(join(root,'rollback-events.sqlite'));
  await assert.rejects(executeAuditedManagedRollback({
   journal,scriptId:'synthetic_script',targetHash:B,expectedCurrentHash:A,
   newId:()=>ID(1),now:()=>NOW,restore:async()=>({hash:C,activePath:'synthetic'}),
  }),/uncertain|review|receipt/i);
  assert.equal(journal.get(ID(1))?.outcome,'uncertain');
  journal.close();
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-041 rejects tampering with its durable append-only operation or outcome',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-audit-'));
 try{
  const file=join(root,'rollback-events.sqlite');
  let journal=openRollbackAuditJournal(file);
  journal.begin({...intent(),at:NOW});
  journal.finish({id:ID(1),outcome:'committed',targetHash:B,at:NOW});
  journal.close();
  let db=new DatabaseSync(file);
  try{
   for(const table of ['rollback_intents','rollback_outcomes']){
    assert.throws(()=>db.exec('DELETE FROM '+table),/append-only/i);
    assert.throws(()=>db.exec('UPDATE '+table+" SET id='forged'"),/append-only|no such column/i);
   }
   db.exec('DROP TRIGGER rollback_intents_no_delete');
   db.exec("CREATE TRIGGER rollback_intents_no_delete BEFORE DELETE ON rollback_intents BEGIN SELECT 1; END;");
  }finally{db.close()}
  assert.throws(()=>openRollbackAuditJournal(file),/trigger|schema|append-only|incompatible/i);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-041 Main rollback path uses append-only durable intent and completion, not unaudited direct restore',async()=>{
 const main=await readFile(new URL('../../../apps/desktop/src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:rollback-managed'");
 const end=main.indexOf("ipcMain.handle('usshm:export-dom-report'",start);
 const handler=main.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(main,/openRollbackAuditJournal\(join\(dataRoot,'rollback-events\.sqlite'\)\)/);
 assert.match(handler,/executeAuditedManagedRollback\(\{/);
 assert.match(handler,/sourceAuditRevisionId/);
 assert.match(handler,/targetAuditRevisionId/);
 assert.match(handler,/restore:.*repairs\.restore/s);
 assert.match(main,/rollbackAuditJournal\.close\(\)/);
});
