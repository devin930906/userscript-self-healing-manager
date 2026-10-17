import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openRollbackAuditJournal} from '../src/rollback-events.ts';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const A='a'.repeat(64),B='b'.repeat(64),t='2026-10-17T08:00:00.000Z';
test('FR-041 read-only rollback audit lookup survives restart and does not mix script histories',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-history-'));
 try{
  const path=join(root,'rollback.sqlite');
  let j=openRollbackAuditJournal(path);
  j.begin({id:id(1),scriptId:'only_script',previousHash:A,targetHash:B,
   sourceAuditRevisionId:null,targetAuditRevisionId:null,at:t});
  j.finish({id:id(1),outcome:'committed',targetHash:B,at:t});
  j.begin({id:id(2),scriptId:'another_script',previousHash:A,targetHash:B,
   sourceAuditRevisionId:null,targetAuditRevisionId:null,at:t});
  j.close();j=openRollbackAuditJournal(path);
  const own=j.listByScript('only_script');
  assert.equal(own.length,1);
  assert.equal(own[0]?.id,id(1));
  assert.equal(own[0]?.outcome,'committed');
  assert.equal(Object.isFrozen(own[0]),true);
  assert.deepEqual(j.listByScript('no_history'),[]);
  assert.throws(()=>j.listByScript('../other'),/invalid|unsafe/i);
  assert.deepEqual(j.listByScript('another_script').map(e=>e.outcome),[null]);
  j.close();
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-041 read-back list has a strict upper bound, with incomplete outcomes labeled, never auto-resolved',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-history-'));
 try{
  const j=openRollbackAuditJournal(join(root,'rollback.sqlite'));
  for(let n=1;n<=61;n++){
   j.begin({id:id(n),scriptId:'sample',previousHash:A,targetHash:B,
    sourceAuditRevisionId:null,targetAuditRevisionId:null,at:t});
   j.finish({id:id(n),outcome:'committed',targetHash:B,at:t});
  }
  const records=j.listByScript('sample');
  assert.ok(records.length>0&&records.length<=50);
  assert.equal(new Set(records.map(e=>e.id)).size,records.length);
  j.close();
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-041 native rollback audit history is only for an authorized scanned script and is visible in the desktop UI',async()=>{
 const main=await readFile(new URL('../../../apps/desktop/src/main/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../../../apps/desktop/src/preload/index.ts',import.meta.url),'utf8');
 const gui=await readFile(new URL('../../../apps/desktop/src/renderer/App.tsx',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:rollback-audit-history'");
 const end=main.indexOf("ipcMain.handle('usshm:export-rollback-audit'",start);
 assert.ok(start>=0&&end>start,'Main must expose only the scoped rollback audit history before write handler');
 const block=main.slice(start,end);
 assert.match(block,/scanSessions\.require\(q\.scanId\)/);
 assert.match(block,/withinAuthorized\(item\.path\)/);
 assert.match(block,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.match(block,/rollbackAuditJournal\.listByScript\(item\.scriptId\)/);
 assert.doesNotMatch(block,/filePath|sqlitePath|databasePath/);
 assert.match(preload,/listRollbackAuditHistory:[^\n]*ipcRenderer\.invoke\('usshm:rollback-audit-history',input\)/);
 assert.match(gui,/window\.ussm\.listRollbackAuditHistory\(\{scanId:result\.scanId,itemIndex:focused\}\)/);
 assert.match(gui,/查看回滚审计记录/);
 assert.match(gui,/未完成.*复核|不确定.*复核/);
 assert.match(gui,/setRollbackAuditEvents\(null\)/,'switching scan or item must drop old audit events');
});
