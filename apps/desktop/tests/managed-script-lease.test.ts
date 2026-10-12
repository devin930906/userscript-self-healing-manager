import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeDurableApprovedBatch} from '../src/main/durable-batch-apply.ts';
import {executeDurableApprovedBatchSet} from '../src/main/durable-batch-set.ts';

async function fixture(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-shared-main-lease-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
function gate(){
 let started!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;});
 const held=new Promise<void>(resolve=>{release=resolve;});
 return {entered,held,started,release};
}
function multi(root:string,scriptId:string,preflight:()=>boolean|Promise<boolean>,write:()=>Promise<unknown>){
 return executeDurableApprovedBatchSet({
  dataRoot:root,groupId:randomUUID(),items:[{
   approvalId:randomUUID(),scriptId,approved:true,preflight,write,
  }],
 });
}
function single(root:string,scriptId:string,preflight:()=>boolean|Promise<boolean>,write:()=>Promise<unknown>){
 return executeDurableApprovedBatch({
  dataRoot:root,approvalId:randomUUID(),scriptId,preflight,write,
 });
}

test('FR-030 single native-approved managed writer blocks simultaneous multi-job writer for same script',async()=>fixture(async root=>{
 const hold=gate(),scriptId='same-managed-script',calls:string[]=[];
 const first=single(root,scriptId,async()=>{hold.started();await hold.held;return true;},
  async()=>{calls.push('single');});
 await hold.entered;
 try{
  await assert.rejects(
   multi(root,scriptId,()=>true,async()=>{calls.push('multi-conflict');}),
   /concurrent|active|already/i,
  );
  assert.deepEqual(calls,[],'conflicting managed write must not run or acquire a journal');
 }finally{hold.release();await first;}
 assert.deepEqual(calls,['single']);
 await multi(root,scriptId,()=>true,async()=>{calls.push('multi-after-release');});
 assert.deepEqual(calls,['single','multi-after-release'],'fresh approval after completion is allowed');
}));

test('FR-030 multi-job managed writer blocks simultaneous existing single native writer for same script',async()=>fixture(async root=>{
 const hold=gate(),scriptId='same-managed-script',calls:string[]=[];
 const first=multi(root,scriptId,async()=>{hold.started();await hold.held;return true;},
  async()=>{calls.push('multi');});
 await hold.entered;
 try{
  await assert.rejects(
   single(root,scriptId,()=>true,async()=>{calls.push('single-conflict');}),
   /concurrent|active|already/i,
  );
  assert.deepEqual(calls,[],'legacy one-script writes must honor the same Main lease');
 }finally{hold.release();await first;}
 assert.deepEqual(calls,['multi']);
 await single(root,scriptId,()=>true,async()=>{calls.push('single-after-release');});
 assert.deepEqual(calls,['multi','single-after-release']);
}));

test('FR-030 unrelated managed scripts may be processed in separate Main executions without global blocking',async()=>fixture(async root=>{
 const hold=gate(),calls:string[]=[];
 const first=single(root,'managed-a',async()=>{hold.started();await hold.held;return true;},
  async()=>{calls.push('a');});
 await hold.entered;
 try{
  const independent=await multi(root,'managed-b',()=>true,async()=>{calls.push('b');});
  assert.equal(independent.completed,1);
  assert.deepEqual(calls,['b']);
 }finally{hold.release();await first;}
 assert.deepEqual(calls,['b','a']);
}));
