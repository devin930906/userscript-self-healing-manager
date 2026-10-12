import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRepairQueueActivity} from '../src/main/repair-queue-activity.ts';
import {executeDurableApprovedBatch} from '../src/main/durable-batch-apply.ts';

test('FR-029 Main-only live queue activity aggregates concurrent approvals without exposing identities',()=>{
 const first=randomUUID(),second=randomUUID();
 const ledger=createRepairQueueActivity();
 ledger.observe(first,'queued');
 ledger.observe(second,'running');
 assert.deepEqual(ledger.snapshot(),{
  queued:1,running:1,completed:0,failed:0,blocked:0,cancelled:0,
 });
 ledger.observe(first,'running');
 ledger.observe(second,'completed');
 assert.deepEqual(ledger.snapshot(),{
  queued:0,running:1,completed:1,failed:0,blocked:0,cancelled:0,
 });
 ledger.observe(first,'failed');
 assert.deepEqual(ledger.snapshot(),{
  queued:0,running:0,completed:1,failed:1,blocked:0,cancelled:0,
 });
 for(const secret of [first,second,'scriptId','filePath','approvalId'])
  assert.equal(JSON.stringify(ledger.snapshot()).includes(secret),false);
});

test('FR-029 activity observer cannot regress completed state or manufacture raw queue identity',()=>{
 const id=randomUUID();
 const ledger=createRepairQueueActivity();
 ledger.observe(id,'queued');
 ledger.observe(id,'running');
 ledger.observe(id,'completed');
 assert.throws(()=>ledger.observe(id,'queued'),/terminal|transition|queue|activity/i);
 assert.deepEqual(ledger.snapshot(),{
  queued:0,running:0,completed:1,failed:0,blocked:0,cancelled:0,
 });
 assert.throws(()=>ledger.observe('PRIVATE_SCRIPT_PATH.user.js','running'),/invalid|identity|activity/i);
 assert.throws(()=>ledger.observe(randomUUID(),'UNKNOWN' as never),/invalid|state|activity/i);
});

test('FR-029 actual durable managed batch emits a redacted progress lifecycle before return',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-fr029-activity-'));
 const id=randomUUID(),secret='PRIVATE_SCRIPT_NAME';
 try{
  const statuses:string[]=[];
  const ledger=createRepairQueueActivity();
  const result=await executeDurableApprovedBatch({
   dataRoot:root,approvalId:id,scriptId:secret,
   preflight:()=>true,
   write:async()=>({ok:true}),
   onProgress:status=>{
    statuses.push(status);
    ledger.observe(id,status);
   },
  });
  assert.deepEqual(result,{ok:true});
  assert.deepEqual([...new Set(statuses)],['queued','running','completed']);
  assert.deepEqual(ledger.snapshot(),{
   queued:0,running:0,completed:1,failed:0,blocked:0,cancelled:0,
  });
  assert.equal(JSON.stringify(ledger.snapshot()).includes(secret),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('FR-029 both native-approved Main write IPC handlers report Main-owned activity to read-only renderer',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(main,/ipcMain\.handle\('usshm:repair-queue-activity',[\s\S]{0,180}assertSender\(event\)/);
 assert.match(main,/return repairQueueActivity\.snapshot\(\)/);
 for(const name of ['usshm:apply-batch-repair','usshm:apply-batch-repair-guarded']){
  const start=main.indexOf("ipcMain.handle('"+name+"'");
  const end=main.indexOf("ipcMain.handle('",start+10);
  assert.ok(start>=0&&end>start);
  const segment=main.slice(start,end);
  assert.match(segment,/onProgress:status=>repairQueueActivity\.observe\(proposalId,status\)/);
 }
 assert.match(preload,/getRepairQueueActivity:\(\)=>ipcRenderer\.invoke\('usshm:repair-queue-activity'\)/);
 assert.match(ui,/window\.ussm\.getRepairQueueActivity\(\)/);
 assert.match(ui,/修复队列进度/);
 assert.doesNotMatch(ui,/window\.ussm\.retryRecovered|window\.ussm\.resumeRecovered/);
});
