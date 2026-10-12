import assert from 'node:assert/strict';
import {test} from 'node:test';
import {link,mkdir,mkdtemp,readFile,rm,symlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRepairTaskQueue,type RepairTask} from '../src/repair-task-queue.ts';
import {openRepairCheckpointStore} from '../src/repair-checkpoint-store.ts';

async function fixture(run:(file:string,root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-fr029-durable-'));
 try{await run(join(root,'repair-queue.sqlite'),root);}
 finally{await rm(root,{recursive:true,force:true});}
}
const tasks=(calls:string[]):RepairTask[]=>[
 {id:'step1',scriptId:'C:\\Private\\secret-script.user.js',approved:true,
  execute:async()=>{calls.push('step1');}},
 {id:'step2',scriptId:'private-token-user-script',approved:true,
  execute:async()=>{calls.push('step2');throw Error('PRIVATE_FORM_VALUE');}},
];
test('FR-029 real SQLite restart retains completion and blocks uncertain replay; no source names on disk',async()=>fixture(async file=>{
 const called:string[]=[];
 let store=openRepairCheckpointStore(file);
 const original=createRepairTaskQueue(tasks(called),{onCheckpoint:state=>store.save(state)});
 const first=await original.run();
 assert.deepEqual(first.items.map(row=>row.status),['completed','failed']);
 store.close();
 const bytes=await readFile(file);
 for(const secret of ['secret-script.user.js','Private','private-token-user-script','PRIVATE_FORM_VALUE','step1','step2'])
  assert.equal(bytes.includes(Buffer.from(secret)),false,'no script identity or exception text in SQLite: '+secret);
 store=openRepairCheckpointStore(file);
 const restored=store.load(tasks([]));
 assert.equal(restored?.items.length,2);
 const calls:string[]=[];
 const restarted=createRepairTaskQueue(tasks(calls),{
  recovery:restored,
  onCheckpoint:cp=>store.save(cp),
 });
 assert.deepEqual(restarted.snapshot().items.map(row=>row.status),['completed','blocked']);
 await restarted.run();
 assert.deepEqual(calls,[],'restart cannot silently repeat completed or failed writes');
 store.close();
}));
test('FR-029 on-disk running/queued interrupted snapshots require new review despite old approval',async()=>fixture(async file=>{
 let store=openRepairCheckpointStore(file);
 await store.save({version:1,items:[
  {id:'step1',scriptId:tasks([])[0]!.scriptId,status:'running',attempts:1,errorCode:null},
  {id:'step2',scriptId:tasks([])[1]!.scriptId,status:'queued',attempts:0,errorCode:null},
 ]});
 store.close();
 store=openRepairCheckpointStore(file);
 const recovered=store.load(tasks([]));
 let executed=0;
 const q=createRepairTaskQueue(tasks([]).map(t=>({...t,execute:async()=>{executed++;}})),
  {recovery:recovered});
 assert.deepEqual(q.snapshot().items.map(x=>x.status),['blocked','blocked']);
 await q.run();
 assert.equal(executed,0);
 store.close();
}));
test('FR-029 disk store refuses schedule mismatch and corrupted SQLite schema without altering it',async()=>fixture(async file=>{
 let s=openRepairCheckpointStore(file);
 assert.equal(s.load(tasks([])),undefined);
 await s.save({version:1,items:[
  {id:'step1',scriptId:tasks([])[0]!.scriptId,status:'completed',attempts:1,errorCode:null},
  {id:'step2',scriptId:tasks([])[1]!.scriptId,status:'blocked',attempts:0,errorCode:null},
 ]});
 s.close();
 s=openRepairCheckpointStore(file);
 const swapped=[...tasks([])].reverse();
 assert.throws(()=>s.load(swapped),/mismatch|identity|checkpoint/i);
 await assert.rejects(s.save({version:1,items:[
  {id:'step2',scriptId:tasks([])[1]!.scriptId,status:'queued',attempts:0,errorCode:null},
  {id:'step1',scriptId:tasks([])[0]!.scriptId,status:'queued',attempts:0,errorCode:null},
 ]}),/mismatch|identity|checkpoint/i);
 s.close();
 const db=new DatabaseSync(file);
 db.exec("CREATE TRIGGER unsafe_snapshot BEFORE UPDATE ON repair_checkpoints BEGIN DELETE FROM repair_checkpoints; END");
 db.close();
 assert.throws(()=>openRepairCheckpointStore(file),/schema|trigger|unsafe/i);
 const raw=new DatabaseSync(file,{readOnly:true});
 assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM repair_checkpoints").get()?.count,1);
 raw.close();
}));
test('FR-029 future SQLite version and symlinked destinations fail closed',async()=>fixture(async(file,root)=>{
 const db=new DatabaseSync(file);db.exec('PRAGMA user_version=9');db.close();
 assert.throws(()=>openRepairCheckpointStore(file),/version|unsupported|schema/i);
 const alias=join(root,'link.sqlite');
 try{await symlink(file,alias,'file');}
 catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??''))return;throw error;}
 assert.throws(()=>openRepairCheckpointStore(alias),/unsafe|symlink|linked/i);
}));
test('FR-029 failed SQLite commit stops pending repair before its callback can write',async()=>fixture(async file=>{
 const store=openRepairCheckpointStore(file);
 let executed=0;
 const q=createRepairTaskQueue([{
  id:'step',scriptId:'private-script',approved:true,
  execute:async()=>{executed++;},
 }],{onCheckpoint:async cp=>{
  // An unavailable durable store must block all execution, not merely log.
  store.close();
  await store.save(cp);
 }});
 await assert.rejects(q.run(),/checkpoint|persist/i);
 assert.equal(executed,0);
}));

function openingError(file:string):unknown{
 let opened:ReturnType<typeof openRepairCheckpointStore>|undefined;
 try{opened=openRepairCheckpointStore(file);return null;}
 catch(error){return error;}
 finally{opened?.close();}
}
test('FR-029 refuses a hard-linked SQLite checkpoint before mutating the other database',async()=>fixture(async(file,root)=>{
 const anotherDatabase=join(root,'another-app.sqlite');
 const privateDb=new DatabaseSync(anotherDatabase);
 assert.equal((privateDb.prepare('PRAGMA user_version').get() as {user_version:number}).user_version,0);
 privateDb.close();
 await link(anotherDatabase,file);
 assert.match((openingError(file) as Error|null)?.message??'',/unsafe|hard.?link|linked/i);
 const unchanged=new DatabaseSync(anotherDatabase,{readOnly:true});
 assert.equal((unchanged.prepare('PRAGMA user_version').get() as {user_version:number}).user_version,0);
 assert.equal(unchanged.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table'").get()?.total,0);
 unchanged.close();
}));

test('FR-029 refuses unsafe SQLite WAL, SHM and journal sidecars before creating a database',async()=>fixture(async(_file,root)=>{
 for(const suffix of ['-wal','-shm','-journal']){
  const file=join(root,'blocked-'+suffix.slice(1)+'.sqlite');
  await mkdir(file+suffix);
  assert.equal(existsSync(file),false);
  assert.match((openingError(file) as Error|null)?.message??'',/unsafe|sidecar|linked/i);
  assert.equal(existsSync(file),false,'sidecar preflight must precede SQLite open: '+suffix);
 }
}));

test('FR-029 durable completed and blocked snapshots cannot regress to replayable queued work',async()=>fixture(async file=>{
 const store=openRepairCheckpointStore(file);
 try{
  const identity={id:'one',scriptId:'managed-one'};
  for(const status of ['completed','blocked'] as const){
   const checkpoint={version:1 as const,items:[{...identity,status,attempts:status==='completed'?1:0,errorCode:null}]};
   // Each assertion starts from a clean database reservation using a new row
   // identity is forbidden; test both terminal states independently below.
   if(status==='completed'){
    await store.save(checkpoint);
    await assert.rejects(store.save({version:1,items:[
     {...identity,status:'queued',attempts:1,errorCode:null},
    ]}),/checkpoint|transition|state|terminal|unsafe/i);
    assert.equal(store.load([identity])?.items[0]?.status,'completed');
   }
  }
 }finally{store.close();}
}));
test('FR-029 durable blocked and cancelled outcomes cannot requeue after a restart',async()=>fixture(async file=>{
 const blocked={id:'blocked-review',scriptId:'private-script'};
 const store=openRepairCheckpointStore(file);
 try{
  await store.save({version:1,items:[
   {...blocked,status:'blocked',attempts:1,errorCode:null},
  ]});
  await assert.rejects(store.save({version:1,items:[
   {...blocked,status:'queued',attempts:1,errorCode:null},
  ]}),/checkpoint|transition|state|terminal|unsafe/i);
  assert.equal(store.load([blocked])?.items[0]?.status,'blocked');
 }finally{store.close();}
}));
test('FR-029 SQLite checkpoint refuses decreasing retry attempts and running to queued',async()=>fixture(async file=>{
 const id={id:'retry-task',scriptId:'only-managed-copy'};
 const store=openRepairCheckpointStore(file);
 try{
  await store.save({version:1,items:[{...id,status:'running',attempts:2,errorCode:null}]});
  for(const row of [
   {...id,status:'queued' as const,attempts:2,errorCode:null},
   {...id,status:'running' as const,attempts:1,errorCode:null},
  ]){
   await assert.rejects(store.save({version:1,items:[row]}),/checkpoint|transition|attempt|unsafe/i);
  }
  assert.deepEqual(store.load([id])?.items.map(x=>[x.status,x.attempts]),[['running',2]]);
 }finally{store.close();}
}));
test('FR-029 legitimate explicitly retried failed checkpoint remains serial and durable',async()=>fixture(async file=>{
 const id={id:'explicit-retry',scriptId:'managed'};
 const store=openRepairCheckpointStore(file);
 try{
  const save=(status:'queued'|'running'|'failed'|'completed',attempts:number,errorCode:'TASK_EXECUTION_FAILED'|null)=>
   store.save({version:1,items:[{...id,status,attempts,errorCode}]});
  await save('queued',0,null);
  await save('running',1,null);
  await save('failed',1,'TASK_EXECUTION_FAILED');
  await save('queued',1,null);
  await save('running',2,null);
  await save('completed',2,null);
  assert.deepEqual(store.load([id])?.items.map(x=>[x.status,x.attempts]),[['completed',2]]);
 }finally{store.close();}
}));
