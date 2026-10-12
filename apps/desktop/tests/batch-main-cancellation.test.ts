import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createActiveBatchCancellation} from '../src/main/batch-main-cancellation.ts';
import {executeDurableApprovedBatch} from '../src/main/durable-batch-apply.ts';
import {openRepairCheckpointStore} from '../../../packages/scan-service/src/repair-checkpoint-store.ts';

async function fixture(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-main-cancel-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
const file=(root:string,id:string)=>join(root,'repair-queue',id+'.sqlite');
const load=(root:string,id:string,scriptId:string)=>{
 const store=openRepairCheckpointStore(file(root,id));
 try{return store.load([{id,scriptId}])?.items[0]?.status;}
 finally{store.close();}
};
test('FR-029 Main cancellation registry rejects stale and unregistered native batch operations',()=>{
 const manager=createActiveBatchCancellation();
 const id=randomUUID(),other=randomUUID();
 let cancelled=0;
 assert.equal(manager.cancel(id),false);
 assert.equal(manager.cancel(other),false);
 const detach=manager.attach(id,()=>{cancelled++;});
 assert.throws(()=>manager.attach(id,()=>{}),/active|duplicate|cancel/i);
 assert.equal(manager.cancel(other),false);
 assert.equal(manager.cancel(id),true);
 assert.equal(cancelled,1);
 detach();
 assert.equal(manager.cancel(id),false);
 assert.throws(()=>manager.attach('../PRIVATE_SCRIPT.user.js',()=>{}),/invalid|identity|cancel/i);
 const detachNew=manager.attach(id,()=>{cancelled++;});
 detach();
 assert.equal(manager.cancel(id),true,'stale detach cannot clear a replacement operation');
 assert.equal(cancelled,2);
 detachNew();
});

test('FR-029 Main cancellation during awaited approved preflight prevents managed write and durably records cancelled',async()=>fixture(async root=>{
 const id=randomUUID(),scriptId='managed-safe';
 const manager=createActiveBatchCancellation();
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>{entered=r;});
 const hold=new Promise<void>(r=>{release=r;});
 let writes=0;
 const executing=executeDurableApprovedBatch({
  dataRoot:root,approvalId:id,scriptId,
  preflight:async()=>{entered();await hold;return true;},
  write:async()=>{writes++;},
  onRegisterCancel:cancel=>manager.attach(id,cancel),
 });
 await started;
 assert.equal(manager.cancel(id),true);
 release();
 await assert.rejects(executing,/blocked|failed|review|cancel/i);
 assert.equal(writes,0);
 assert.equal(load(root,id,scriptId),'cancelled');
 assert.equal(manager.cancel(id),false,'no stale cancellation after batch settles');
}));

test('FR-029 cancelling after managed write started does not falsely claim rollback of a committed revision',async()=>fixture(async root=>{
 const id=randomUUID(),scriptId='managed-safe';
 const manager=createActiveBatchCancellation();
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>{entered=r;});
 const hold=new Promise<void>(r=>{release=r;});
 let writes=0;
 const executing=executeDurableApprovedBatch({
  dataRoot:root,approvalId:id,scriptId,
  preflight:()=>true,
  write:async()=>{writes++;entered();await hold;return {hash:'committed-managed-revision'};},
  onRegisterCancel:cancel=>manager.attach(id,cancel),
 });
 await started;
 assert.equal(manager.cancel(id),true);
 release();
 assert.deepEqual(await executing,{hash:'committed-managed-revision'});
 assert.equal(writes,1);
 assert.equal(load(root,id,scriptId),'completed');
 assert.equal(manager.cancel(id),false);
}));

test('FR-029 desktop cancel IPC is sender-guarded and only applies to active Main batch proposal',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(main,/ipcMain\.handle\('usshm:cancel-batch-repair',async\(event,input:unknown\)=>\{\s*assertSender\(event\)/);
 assert.match(main,/return repairQueueCancellation\.cancel\(q\.proposalId\)/);
 for(const channel of ['usshm:apply-batch-repair','usshm:apply-batch-repair-guarded']){
  const start=main.indexOf("ipcMain.handle('"+channel+"'");
  const end=main.indexOf("ipcMain.handle('",start+12);
  assert.ok(start>=0&&end>start);
  assert.match(main.slice(start,end),/onRegisterCancel:\(cancel,pause,resume\)=>repairQueueCancellation\.attach\(proposalId,cancel,\{pause,resume\}\)/);
 }
 assert.match(preload,/cancelBatchRepair:\(input:\{proposalId:string\}\)=>ipcRenderer\.invoke\('usshm:cancel-batch-repair',input\)/);
 assert.match(ui,/window\.ussm\.cancelBatchRepair\(/);
 assert.match(ui,/取消当前批量修复/);
 assert.match(ui,/正在写入的修订可能已经完成/);
});

test('FR-029 Main pause and resume controls are scoped to the active approved batch UUID',()=>{
 const manager=createActiveBatchCancellation();
 const id=randomUUID(),other=randomUUID();
 let paused=false;
 const detach=manager.attach(id,()=>{},{
  pause:()=>{if(paused)return false;paused=true;return true;},
  resume:()=>{paused=false;},
 });
 assert.equal(manager.pause(other),false);
 assert.equal(manager.resume(other),false);
 assert.equal(manager.pause(id),true);
 assert.equal(paused,true);
 assert.equal(manager.pause(id),false);
 assert.equal(manager.resume(id),true);
 assert.equal(paused,false);
 detach();
 assert.equal(manager.pause(id),false);
 assert.equal(manager.resume(id),false);
 assert.throws(()=>manager.pause('../secret.user.js'),/invalid|identity/i);
});

test('FR-029 paused approved batch must not dispatch a file write until explicit resume, then revalidate',async()=>fixture(async root=>{
 const id=randomUUID(),scriptId='managed-safe';
 const manager=createActiveBatchCancellation();
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>{entered=r;});
 const hold=new Promise<void>(r=>{release=r;});
 let checks=0,writes=0;
 const active=executeDurableApprovedBatch({
  dataRoot:root,approvalId:id,scriptId,
  preflight:async()=>{checks++;if(checks===1){entered();await hold;}return true;},
  write:async()=>{writes++;return 'committed';},
  onRegisterCancel:(cancel,pause,resume)=>manager.attach(id,cancel,{pause,resume}),
 });
 await started;
 assert.equal(manager.pause(id),true);
 release();
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(writes,0,'pause must gate dispatch after asynchronous Main preflight');
 assert.equal(manager.resume(id),true);
 assert.equal(await active,'committed');
 assert.equal(checks,2,'stale pre-pause authorization cannot be reused');
 assert.equal(writes,1);
 assert.equal(load(root,id,scriptId),'completed');
 assert.equal(manager.pause(id),false);
}));

test('FR-029 resumed batch with newly revoked approval persists blocked rather than executing',async()=>fixture(async root=>{
 const id=randomUUID(),scriptId='managed-safe';
 const manager=createActiveBatchCancellation();
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>{entered=r;});
 const hold=new Promise<void>(r=>{release=r;});
 let checks=0,writes=0;
 const active=executeDurableApprovedBatch({
  dataRoot:root,approvalId:id,scriptId,
  preflight:async()=>{checks++;if(checks===1){entered();await hold;return true;}return false;},
  write:async()=>{writes++;},
  onRegisterCancel:(cancel,pause,resume)=>manager.attach(id,cancel,{pause,resume}),
 });
 await started;
 assert.equal(manager.pause(id),true);
 release();
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(writes,0);
 assert.equal(manager.resume(id),true);
 await assert.rejects(active,/blocked|failed|review/i);
 assert.equal(checks,2);
 assert.equal(writes,0);
 assert.equal(load(root,id,scriptId),'blocked');
}));

test('FR-029 desktop pause/resume are Main-owned guarded IPC controls on both reviewed batch paths',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 for(const [verb,method] of [['pause','pause'],['resume','resume']] as const){
  assert.match(main,new RegExp("ipcMain\\.handle\\('usshm:"+verb+"-batch-repair',async\\(event,input:unknown\\)=>\\{\\s*assertSender\\(event\\)"));
  assert.match(main,new RegExp("return repairQueueCancellation\\."+method+"\\(q\\.proposalId\\)"));
  assert.match(preload,new RegExp(verb+"BatchRepair:\\(input:\\{proposalId:string\\}\\)=>ipcRenderer\\.invoke\\('usshm:"+verb+"-batch-repair',input\\)"));
  assert.match(ui,new RegExp('window\\.ussm\\.'+verb+'BatchRepair\\('));
 }
 assert.match(ui,/暂停当前批量修复/);
 assert.match(ui,/恢复当前批量修复/);
 assert.match(ui,/重新验证/);
});
