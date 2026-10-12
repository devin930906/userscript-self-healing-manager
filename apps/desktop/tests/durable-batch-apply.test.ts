import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {executeDurableApprovedBatch} from '../src/main/durable-batch-apply.ts';
import {openRepairCheckpointStore} from '../../../packages/scan-service/src/repair-checkpoint-store.ts';

async function fixture(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-main-fr029-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
const file=(root:string,id:string)=>join(root,'repair-queue',id+'.sqlite');

test('FR-029 Electron Main writes only after committed running checkpoint and records completion',async()=>fixture(async root=>{
 const approvalId=randomUUID(), scriptId='trusted-script';
 let preflights=0,writes=0;
 const output=await executeDurableApprovedBatch({
  dataRoot:root,approvalId,scriptId,
  preflight:()=>{preflights++;return true;},
  write:async()=>{
   writes++;
   const db=new DatabaseSync(file(root,approvalId),{readOnly:true});
   try{
    const row=db.prepare('SELECT payload FROM repair_checkpoints WHERE slot=1').get() as {payload:string};
    assert.equal(JSON.parse(row.payload).rows[0].status,'running',
     'the running checkpoint must be committed before the managed-file write');
   }finally{db.close();}
   return {hash:'verified-result'};
  },
 });
 assert.deepEqual(output,{hash:'verified-result'});
 assert.equal(preflights,1);
 assert.equal(writes,1);
 const store=openRepairCheckpointStore(file(root,approvalId));
 try{
  assert.deepEqual(store.load([{id:approvalId,scriptId}])?.items.map(row=>row.status),['completed']);
 }finally{store.close();}
 const bytes=await readFile(file(root,approvalId));
 assert.equal(bytes.includes(Buffer.from(scriptId)),false,'no script identity on disk');
 assert.equal(bytes.includes(Buffer.from(approvalId)),false,'no raw approval UUID on disk');
}));

test('FR-029 old approval cannot replay after process restart or after a failed write',async()=>fixture(async root=>{
 const approvalId=randomUUID(),scriptId='fresh-script';
 let writes=0;
 await assert.rejects(executeDurableApprovedBatch({
  dataRoot:root,approvalId,scriptId,preflight:()=>true,
  write:async()=>{writes++;throw Error('PRIVATE_USER_SCRIPT_CONTENT');},
 }),error=>error instanceof Error&&/repair|batch|checkpoint/i.test(error.message)&&
  !error.message.includes('PRIVATE_USER_SCRIPT_CONTENT'));
 assert.equal(writes,1);
 const store=openRepairCheckpointStore(file(root,approvalId));
 try{assert.equal(store.load([{id:approvalId,scriptId}])?.items[0]?.status,'failed');}
 finally{store.close();}
 await assert.rejects(executeDurableApprovedBatch({
  dataRoot:root,approvalId,scriptId,preflight:()=>true,
  write:async()=>{writes++;},
 }),/existing|checkpoint|replay|review/i);
 assert.equal(writes,1,'old reviewed approval must never be replayed');
}));

test('FR-029 revoked preflight and invalid approval identities are fail closed',async()=>fixture(async root=>{
 let called=0;
 const approvalId=randomUUID();
 await assert.rejects(executeDurableApprovedBatch({
  dataRoot:root,approvalId,scriptId:'safe',
  preflight:()=>false,write:async()=>{called++;},
 }),/blocked|preflight|rejected|approval/i);
 assert.equal(called,0);
 const store=openRepairCheckpointStore(file(root,approvalId));
 try{assert.notEqual(store.load([{id:approvalId,scriptId:'safe'}])?.items[0]?.status,'completed');}
 finally{store.close();}
 for(const badId of ['../outside','', 'other.sqlite']){
  await assert.rejects(executeDurableApprovedBatch({
   dataRoot:root,approvalId:badId,scriptId:'safe',
   preflight:()=>true,write:async()=>{called++;},
  }),/invalid|identity|approval/i);
 }
 assert.equal(called,0);
}));

test('FR-029 both Electron Main batch apply paths use the durable pre-write queue',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 for(const name of ['usshm:apply-batch-repair','usshm:apply-batch-repair-guarded']){
  const start=main.indexOf("ipcMain.handle('"+name+"'");
  const end=main.indexOf("ipcMain.handle('",start+12);
  assert.ok(start>=0&&end>start);
  const handler=main.slice(start,end);
  assert.match(handler,/executeDurableApprovedBatch\(/);
  assert.match(handler,/dataRoot,approvalId:proposalId/);
  assert.match(handler,/preflight:/);
  assert.match(handler,/batchRepairs\.applyBatch\(/);
  assert.match(handler,/approveAndApplyManagedRevision\(/);
 }
});
