import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRepairTaskQueue,type RepairTask} from '../src/repair-task-queue.ts';
import {openRepairCheckpointStore} from '../src/repair-checkpoint-store.ts';

async function withStore(
 run:(store:ReturnType<typeof openRepairCheckpointStore>,file:string)=>Promise<void>,
){
 const directory=await mkdtemp(join(tmpdir(),'usshm-fr029-terminal-'));
 const file=join(directory,'checkpoints.sqlite');
 const store=openRepairCheckpointStore(file);
 try{await run(store,file);}
 finally{store.close();await rm(directory,{force:true,recursive:true});}
}
const newTask=(execute:()=>Promise<void>=async()=>{}):RepairTask=>({
 id:'review-1',scriptId:'managed-script-1',approved:true,execute,
});
const readStatus=(file:string):string|undefined=>{
 const opened=openRepairCheckpointStore(file);
 try{return opened.load([newTask()])?.items[0]?.status;}
 finally{opened.close();}
};

test('FR-029 rejected async preflight is durably blocked on SQLite before Main closes',async()=>withStore(async(store,file)=>{
 let writes=0;
 const queue=createRepairTaskQueue([newTask(async()=>{writes++;})],{
  beforeDispatch:async()=>false,
  onCheckpoint:checkpoint=>store.save(checkpoint),
 });
 assert.equal((await queue.run()).items[0]?.status,'blocked');
 assert.equal(writes,0);
 assert.equal(readStatus(file),'blocked','durable journal must not advertise a queued approval after denial');
}));

test('FR-029 revoked live consent during running progress persists blocked status',async()=>withStore(async(store,file)=>{
 let writes=0;
 const task=newTask(async()=>{writes++;});
 const queue=createRepairTaskQueue([task],{
  onProgress:state=>{if(state.items[0]?.status==='running')task.approved=false;},
  onCheckpoint:checkpoint=>store.save(checkpoint),
 });
 assert.equal((await queue.run()).items[0]?.status,'blocked');
 assert.equal(writes,0);
 assert.equal(readStatus(file),'blocked');
}));

test('FR-029 cancelling in running progress persists cancelled state without calling write',async()=>withStore(async(store,file)=>{
 let writes=0;
 let queue:ReturnType<typeof createRepairTaskQueue>;
 queue=createRepairTaskQueue([newTask(async()=>{writes++;})],{
  onProgress:state=>{if(state.items[0]?.status==='running')queue.cancel();},
  onCheckpoint:checkpoint=>store.save(checkpoint),
 });
 assert.equal((await queue.run()).items[0]?.status,'cancelled');
 assert.equal(writes,0);
 assert.equal(readStatus(file),'cancelled');
}));

test('FR-029 thrown private preflight errors block durably without persisting secret text',async()=>withStore(async(store,file)=>{
 const secret='PRIVATE_PAGE_TOKEN_AND_PATH';
 let writes=0;
 const queue=createRepairTaskQueue([newTask(async()=>{writes++;})],{
  beforeDispatch:async()=>{throw Error(secret);},
  onCheckpoint:checkpoint=>store.save(checkpoint),
 });
 assert.equal((await queue.run()).items[0]?.status,'blocked');
 assert.equal(writes,0);
 assert.equal(readStatus(file),'blocked');
 assert.equal((await readFile(file)).includes(Buffer.from(secret)),false);
}));
