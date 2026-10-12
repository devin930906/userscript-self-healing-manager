import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,symlink} from 'node:fs/promises';
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
