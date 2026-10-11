import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('long-running Chrome and filesystem observations must revalidate approval expiry immediately before managed activation',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 for(const [name,next,apply] of [
  ['usshm:apply-batch-repair-guarded','usshm:apply-repair-guarded','batchRepairs.applyBatch'],
  ['usshm:apply-repair-guarded','usshm:apply-repair','repairs.apply'],
  ['usshm:apply-batch-repair','usshm:apply-batch-repair-guarded','batchRepairs.applyBatch'],
 ]){
  const start=main.indexOf("ipcMain.handle('"+name+"'");
  const end=main.indexOf("ipcMain.handle('"+next+"'",start+3);
  assert.ok(start>=0&&end>start,'native IPC '+name+' is missing');
  const src=main.slice(start,end);
  const at=src.lastIndexOf('pendingApprovals.require(q.proposalId,scanSnapshot.scanId)');
  const lastCheck=src.indexOf('scanSessions.assertCurrent(scanSnapshot)',at);
  const applying=src.indexOf(apply+'(');
  assert.ok(at>=0&&applying>at,name+' must re-check approval before apply');
  assert.ok(lastCheck>=0&&lastCheck<applying,name+' must re-check scan before apply');
 }
});
