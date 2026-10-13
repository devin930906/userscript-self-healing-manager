import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
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


test('FR-029 synchronous native cancellation before a one-script run persists cancelled/zero-attempts',async()=>fixture(async root=>{
 const approvalId=randomUUID(),scriptId='early-cancel';
 let preflights=0,writes=0,releases=0;
 await assert.rejects(executeDurableApprovedBatch({
  dataRoot:root,approvalId,scriptId,
  preflight:()=>{preflights++;return true;},
  write:async()=>{writes++;return {ok:true};},
  onRegisterCancel:cancel=>{cancel();return ()=>{releases++;};},
 }),/cancel|blocked|fresh review/i);
 assert.equal(preflights,0);
 assert.equal(writes,0);
 assert.equal(releases,1);
 const journal=openRepairCheckpointStore(file(root,approvalId));
 try{
  assert.deepEqual(journal.load([{id:approvalId,scriptId}])?.items.map(row=>[row.status,row.attempts]),
   [['cancelled',0]],'cancelled journal must not be empty or replayable');
 }finally{journal.close();}
}));


test('FR-029 native control cleanup failure cannot leak a SQLite checkpoint handle or private callback text',async t=>fixture(async root=>{
 const approvalId=randomUUID(),scriptId='release-failure';
 const close=DatabaseSync.prototype.close;
 const closeSpy=t.mock.method(DatabaseSync.prototype,'close',function(this:DatabaseSync){
  return close.call(this);
 });
 let writes=0,observed:unknown;
 try{
  await executeDurableApprovedBatch({
   dataRoot:root,approvalId,scriptId,
   preflight:()=>true,
   write:async()=>{writes++;return 'written';},
   onRegisterCancel:()=>()=>{throw Error('PRIVATE_NATIVE_CLEANUP_DETAIL');},
  });
 }catch(error){observed=error;}
 assert.equal(writes,1,'the cleanup failure happens only after the managed write completes');
 assert.ok(observed instanceof Error,'a failed cleanup must be reported, not silently ignored');
 assert.equal(closeSpy.mock.callCount(),2,
  'both the checkpoint SQLite connection and the managed write lease connection must close even if Main cleanup throws');
 assert.doesNotMatch(observed.message,/PRIVATE_NATIVE_CLEANUP_DETAIL/,
  'trusted callback errors must not leak private data through Main');
 const store=openRepairCheckpointStore(file(root,approvalId));
 try{
  assert.equal(store.load([{id:approvalId,scriptId}])?.items[0]?.status,'completed',
   'a cleanup error must not erase the checkpoint of an already committed write');
 }finally{store.close();}
}));


test('FR-029 Main native control registration failure is generic and releases the managed script lease',async()=>fixture(async root=>{
 const approvalId=randomUUID(),scriptId='registration-error';
 let written=0,caught:unknown;
 try{
  await executeDurableApprovedBatch({
   dataRoot:root,approvalId,scriptId,
   preflight:()=>true,write:async()=>{written++;return 'old';},
   onRegisterCancel:()=>{throw Error('PRIVATE_NATIVE_REGISTRATION_CONTEXT');},
  });
 }catch(error){caught=error;}
 assert.equal(written,0,'registration failure must never start a managed write');
 assert.ok(caught instanceof Error);
 assert.doesNotMatch(caught.message,/PRIVATE_NATIVE_REGISTRATION_CONTEXT/);
 assert.match(caught.message,/registration|fresh review/i);
 const value=await executeDurableApprovedBatch({
  dataRoot:root,approvalId:randomUUID(),scriptId,
  preflight:()=>true,write:async()=>{written++;return 'fresh';},
 });
 assert.equal(value,'fresh','failed registration may not retain a managed-script write lock');
 assert.equal(written,1);
}));


test('FR-029 a case-only spelling of a consumed native approval UUID cannot replay on any filesystem',async()=>fixture(async root=>{
 const lower='abcdef12-3456-4abc-8def-1234567890ab';
 const upper=lower.toUpperCase();
 let writes=0;
 const task=(approvalId:string)=>({
  dataRoot:root,approvalId,scriptId:'same-reviewed-source',
  preflight:()=>true,write:async()=>{writes++;return 'written';},
 });
 assert.equal(await executeDurableApprovedBatch(task(lower)),'written');
 await assert.rejects(executeDurableApprovedBatch(task(upper)),
  /checkpoint|review|replay|unavailable/i,
  'UUID identity must not depend on Linux case-sensitive journal filenames');
 assert.equal(writes,1,'one logical approval cannot authorize a second managed write');
}));


test('FR-029 legacy upper-case SQLite approval checkpoint also blocks new lower-case replay on Linux',async()=>fixture(async root=>{
 const lower='abcdef12-3456-4abc-8def-1234567890ab';
 await mkdir(join(root,'repair-queue'));
 // Simulate an existing older Alpha checkpoint whose filename used its raw UUID.
 await writeFile(file(root,lower.toUpperCase()),Buffer.from('LEGACY_JOURNAL_DO_NOT_TRUST'));
 let writes=0;
 await assert.rejects(executeDurableApprovedBatch({
  dataRoot:root,approvalId:lower,scriptId:'same-reviewed-source',
  preflight:()=>true,write:async()=>{writes++;return 'replayed';},
 }),/checkpoint|review|replay|unavailable/i,
 'new canonical filenames must not reauthorize a legacy case-variant journal');
 assert.equal(writes,0);
}));

test('FR-029 single managed approval enters the durable queue before its revision write',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:apply-repair'");
 const end=main.indexOf("ipcMain.handle('",start+12);
 assert.ok(start>=0&&end>start,'the single managed repair IPC handler must be registered');
 const handler=main.slice(start,end);
 assert.match(handler,/apply:\s*\(\)=>executeDurableApprovedBatch\(\{/,
  'native confirmation alone must not bypass the durable pre-write checkpoint');
 assert.match(handler,/dataRoot,approvalId:proposalId,scriptId:trusted\.scriptId/);
 assert.match(handler,/preflight:\s*\(\)=>\{/);
 assert.match(handler,/pendingApprovals\.require\(proposalId,scanSnapshot\.scanId\)/);
 assert.match(handler,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.match(handler,/assertManagedProposalSnapshot\(trusted,repairs\.inspectPending\(proposalId\)\)/);
 assert.match(handler,/write:\s*\(\)=>repairs\.apply\(\{proposalId,approved:true\}\)/,
  'the actual managed-file writer must run only as a queued job');
});

test('FR-029 single Main approval revoked between preflight and running checkpoint never writes',async()=>fixture(async root=>{
 const approvalId=randomUUID(),scriptId='late-revocation';
 let checks=0,writes=0;
 await assert.rejects(executeDurableApprovedBatch({
  dataRoot:root,approvalId,scriptId,
  preflight:()=>++checks===1,
  write:async()=>{writes++;return 'must-never-write';},
 }),/blocked|repair|approval|review/i);
 assert.equal(checks,2,'Main-owned approval must be re-read after committing running state');
 assert.equal(writes,0);
 const store=openRepairCheckpointStore(file(root,approvalId));
 try{assert.equal(store.load([{id:approvalId,scriptId}])?.items[0]?.status,'blocked');}
 finally{store.close();}
}));
