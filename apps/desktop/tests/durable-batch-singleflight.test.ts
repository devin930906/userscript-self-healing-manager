import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeDurableApprovedBatchSet} from '../src/main/durable-batch-set.ts';

async function fixture(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-singleflight-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
const job=(scriptId:string,write:()=>Promise<unknown>=async()=>{})=>({
 approvalId:randomUUID(),scriptId,approved:true,preflight:async()=>true,write,
});
test('FR-030 two concurrent groups cannot write the same managed script in one Main process',async()=>fixture(async root=>{
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>{entered=r;});
 const held=new Promise<void>(r=>{release=r;});
 let writes=0;
 const original=executeDurableApprovedBatchSet({
  dataRoot:root,groupId:randomUUID(),items:[job('same-script',async()=>{writes++;entered();await held;})],
 });
 await started;
 try{
  await assert.rejects(executeDurableApprovedBatchSet({
   dataRoot:root,groupId:randomUUID(),items:[job('same-script',async()=>{writes++;})],
  }),/active|concurrent|exclusive|locked|script|duplicate/i);
  assert.equal(writes,1,'no second overlapping write to the identical managed source');
 }finally{release();await original;}
 assert.equal(writes,1);
}));

test('FR-030 disjoint managed scripts may proceed while one batch is blocked in a trusted write',async()=>fixture(async root=>{
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>{entered=r;});
 const held=new Promise<void>(r=>{release=r;});
 const first=executeDurableApprovedBatchSet({
  dataRoot:root,groupId:randomUUID(),items:[job('managed-A',async()=>{entered();await held;})],
 });
 await started;
 try{
  assert.equal((await executeDurableApprovedBatchSet({
   dataRoot:root,groupId:randomUUID(),items:[job('managed-B')],
  })).completed,1);
 }finally{release();await first;}
}));

test('FR-030 a failed or rejected batch releases the original script lock for a NEW reviewed approval',async()=>fixture(async root=>{
 const first=await executeDurableApprovedBatchSet({
  dataRoot:root,groupId:randomUUID(),items:[{
   ...job('managed-C'),preflight:async()=>false,
  }],
 });
 assert.equal(first.blocked,1);
 const second=await executeDurableApprovedBatchSet({
  dataRoot:root,groupId:randomUUID(),items:[job('managed-C')],
 });
 assert.equal(second.completed,1);
}));

test('FR-030 independently managed data roots do not share Main singleflight ownership',async()=>{
 const left=await mkdtemp(join(tmpdir(),'usshm-left-'));
 const right=await mkdtemp(join(tmpdir(),'usshm-right-'));
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>{entered=r;});
 const held=new Promise<void>(r=>{release=r;});
 try{
  const first=executeDurableApprovedBatchSet({
   dataRoot:left,groupId:randomUUID(),items:[job('script-X',async()=>{entered();await held;})],
  });
  await started;
  try{
   assert.equal((await executeDurableApprovedBatchSet({
    dataRoot:right,groupId:randomUUID(),items:[job('script-X')],
   })).completed,1);
  }finally{release();await first;}
 }finally{await rm(left,{recursive:true,force:true});await rm(right,{recursive:true,force:true});}
});
