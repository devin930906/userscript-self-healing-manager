import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectRepairQueueRecovery} from '../src/main/repair-queue-recovery.ts';
import {openRepairCheckpointStore} from '../../../packages/scan-service/src/repair-checkpoint-store.ts';

async function fixture(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-fr029-recovery-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
const record=(id:string,status:'queued'|'running'|'completed'|'failed'|'blocked'|'cancelled',attempts:number)=>({
 id,scriptId:'PRIVATE_SCRIPT_'+id,status,attempts,
 errorCode:status==='failed'?'TASK_EXECUTION_FAILED' as const:null,
});
test('FR-029 first launch with no approved repairs reports an empty sanitized recovery summary',async()=>fixture(async root=>{
 assert.deepEqual(inspectRepairQueueRecovery(root),{
  checkpointFiles:0,completed:0,needsReview:0,uncertain:0,unreadable:0,
 });
}));

test('FR-029 restarted desktop counts committed, uncertain and blocked SQLite rows but never resumes them',async()=>fixture(async root=>{
 const folder=join(root,'repair-queue');
 await mkdir(folder);
 const first=openRepairCheckpointStore(join(folder,randomUUID()+'.sqlite'));
 await first.save({version:1,items:[
  record('COMPLETED','completed',1),
  record('INTERRUPTED','running',1),
  record('BLOCKED','blocked',0),
 ]});
 first.close();
 const second=openRepairCheckpointStore(join(folder,randomUUID()+'.sqlite'));
 await second.save({version:1,items:[record('FAILED','failed',1)]});
 second.close();
 const result=inspectRepairQueueRecovery(root);
 assert.deepEqual(result,{checkpointFiles:2,completed:1,needsReview:3,uncertain:2,unreadable:0});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SCRIPT|INTERRUPTED|COMPLETED|FAILED|BLOCKED|\\|\.sqlite|[a-f0-9]{8}-[a-f0-9]{4}/);
 assert.deepEqual(inspectRepairQueueRecovery(root),result,'read-only status must remain unchanged across repeat inspection');
}));

test('FR-029 interrupted reservation and malformed database cannot be hidden as a clean recovery state',async()=>fixture(async root=>{
 const folder=join(root,'repair-queue');
 await mkdir(folder);
 const first=randomUUID(),second=randomUUID();
 await writeFile(join(folder,first+'.sqlite'),Buffer.alloc(0));
 await writeFile(join(folder,second+'.sqlite'),Buffer.from('NOT-SQLITE-PRIVATE'));
 const result=inspectRepairQueueRecovery(root);
 assert.deepEqual(result,{checkpointFiles:2,completed:0,needsReview:0,uncertain:0,unreadable:2});
 assert.equal(JSON.stringify(result).includes(first),false);
 assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
}));

test('FR-029 symlinked checkpoint directory fails closed without walking its target',async()=>fixture(async root=>{
 const external=join(root,'outside'),alias=join(root,'repair-queue');
 await mkdir(external);
 await writeFile(join(external,randomUUID()+'.sqlite'),Buffer.from('SECRET_EXTERNAL_DATA'));
 try{await symlink(external,alias,'dir');}
 catch(e){if(['EPERM','EACCES','ENOTSUP'].includes((e as NodeJS.ErrnoException).code??''))return;throw e;}
 const result=inspectRepairQueueRecovery(root);
 assert.equal(result.unreadable>0,true);
 assert.equal(result.completed,0);
 assert.equal(result.needsReview,0);
 assert.equal(JSON.stringify(result).includes('SECRET_EXTERNAL_DATA'),false);
}));

test('FR-029 recovery status crosses an explicitly named trusted Main IPC and renderer warning only',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(main,/ipcMain\.handle\('usshm:repair-queue-recovery',[\s\S]{0,200}assertSender\(event\)/);
 assert.match(main,/inspectRepairQueueRecovery\(dataRoot\)/);
 assert.match(preload,/getRepairQueueRecovery:\(\)=>ipcRenderer\.invoke\('usshm:repair-queue-recovery'\)/);
 assert.match(ui,/window\.ussm\.getRepairQueueRecovery\(\)/);
 assert.match(ui,/重新扫描并审批/);
 assert.doesNotMatch(ui,/window\.ussm\.retryRecovered|window\.ussm\.resumeRecovered/);
});


test('FR-029 orphan SQLite WAL/SHM/journal sidecars without a matching UUID checkpoint are not silently ignored',async()=>fixture(async root=>{
 const folder=join(root,'repair-queue');
 await mkdir(folder);
 const validOrphan=randomUUID();
 const suffixes=['-wal','-shm','-journal'];
 for(const suffix of suffixes){
  await writeFile(join(folder,validOrphan+'.sqlite'+suffix),'ORPHAN_PRIVATE');
  await writeFile(join(folder,'not-a-uuid.sqlite'+suffix),'INVALID_PRIVATE');
 }
 const result=inspectRepairQueueRecovery(root);
 assert.deepEqual(result,{
  checkpointFiles:0,completed:0,needsReview:0,uncertain:0,unreadable:6,
 },'each unpaired or malformed sidecar is a recovery warning, not a clean state');
 assert.doesNotMatch(JSON.stringify(result),/ORPHAN_PRIVATE|INVALID_PRIVATE|not-a-uuid/);
}));

test('FR-029 ordinary SQLite WAL/SHM sidecars paired with a live valid checkpoint do not create false alarms',async()=>fixture(async root=>{
 const folder=join(root,'repair-queue');
 await mkdir(folder);
 const db=openRepairCheckpointStore(join(folder,randomUUID()+'.sqlite'));
 try{
  await db.save({version:1,items:[record('ACTIVE','completed',1)]});
  assert.deepEqual(inspectRepairQueueRecovery(root),{
   checkpointFiles:1,completed:1,needsReview:0,uncertain:0,unreadable:0,
  });
 }finally{db.close();}
}));


test('FR-029 recovery refuses to count case-only aliases of one historical UUID as two completed approvals',async t=>fixture(async root=>{
 // NTFS merges these names already; Linux needs explicit UUID canonicalization.
 if(process.platform==='win32'){t.skip('requires case-sensitive checkpoint filenames');return;}
 const folder=join(root,'repair-queue');
 await mkdir(folder);
 const lower='abcdef12-3456-4abc-8def-1234567890ab';
 const upper=lower.toUpperCase();
 for(const name of [lower,upper]){
  const store=openRepairCheckpointStore(join(folder,name+'.sqlite'));
  try{await store.save({version:1,items:[record('PRIVATE_ALIAS','completed',1)]});}
  finally{store.close();}
 }
 const found=inspectRepairQueueRecovery(root);
 assert.deepEqual(found,{
  checkpointFiles:2,completed:0,needsReview:0,uncertain:0,unreadable:2,
 },'two physical SQLite files for one UUID must be treated as ambiguous, not two approvals');
 assert.doesNotMatch(JSON.stringify(found),/PRIVATE_ALIAS|abcdef12|ABCDEF12/);
}));

test('FR-029 recovery flags a failed queue after real managed write started as an uncertain activation',async()=>fixture(async root=>{
 const {executeDurableApprovedBatch}=await import('../src/main/durable-batch-apply.ts');
 const managed=join(root,'synthetic-managed-revision.user.js');
 let attempts=0;
 const approvalId=randomUUID();
 await assert.rejects(executeDurableApprovedBatch({
  dataRoot:root,approvalId,scriptId:'recovery-synthetic',
  preflight:()=>true,
  write:async()=>{
   attempts++;
   await writeFile(managed,'UNVERIFIED_NEW_REVISION');
   throw new Error('PRIVATE_WRITE_ERROR_AND_ACCOUNT');
  },
 }),/blocked|repair|fresh review/i);
 assert.equal(attempts,1);
 assert.equal(await readFile(managed,'utf8'),'UNVERIFIED_NEW_REVISION');
 const state=inspectRepairQueueRecovery(root);
 assert.deepEqual(state,{
  checkpointFiles:1,completed:0,needsReview:1,uncertain:1,unreadable:0,
 },'a failed dispatched write is ambiguous, never a provably untouched script');
 assert.equal(JSON.stringify(state).includes('PRIVATE_WRITE_ERROR_AND_ACCOUNT'),false);
 assert.deepEqual(inspectRepairQueueRecovery(root),state,'read-only recovery cannot replay a failed write');
}));

test('FR-029 denied pre-write gate is review-only, not an uncertain activation',async()=>fixture(async root=>{
 const {executeDurableApprovedBatch}=await import('../src/main/durable-batch-apply.ts');
 let writes=0;
 await assert.rejects(executeDurableApprovedBatch({
  dataRoot:root,approvalId:randomUUID(),scriptId:'prewrite-denial',
  preflight:()=>false,
  write:async()=>{writes++;},
 }),/blocked|repair|fresh review/i);
 assert.equal(writes,0);
 assert.deepEqual(inspectRepairQueueRecovery(root),{
  checkpointFiles:1,completed:0,needsReview:1,uncertain:0,unreadable:0,
 });
}));

test('FR-029 startup text warns about any uncertain activated revision rather than only interrupted in-flight tasks',async()=>{
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(ui,/可能已写入或写入结果不确定/);
 assert.match(ui,/检查受管修订完整性/);
});
