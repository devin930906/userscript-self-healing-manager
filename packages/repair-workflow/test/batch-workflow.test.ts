import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBatchRepairWorkflow} from '../src/batch.ts';

const source='document.querySelector("#old-a");\ndocument.querySelector("#old-b");\n';
const changes=[
 {oldSelector:'#old-a',newSelector:'#fixed-a',selectorLocation:{method:'querySelector',line:1,column:1}},
 {oldSelector:'#old-b',newSelector:'#fixed-b',selectorLocation:{method:'querySelector',line:2,column:1}},
];
async function fixture(task:(paths:{root:string;sourcePath:string;managedRoot:string})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-batch-workflow-'));
 try{
  const sourcePath=join(root,'source.user.js'),managedRoot=join(root,'Data');
  await mkdir(managedRoot);await writeFile(sourcePath,source);
  await task({root,sourcePath,managedRoot});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('batch workflow previews whole source and commits both selectors together to managed current',async()=>fixture(async({sourcePath,managedRoot})=>{
 const workflow=createBatchRepairWorkflow({managedRoot});
 const approved=await workflow.proposeBatch({sourcePath,scriptId:'batch-safe',changes});
 assert.ok(approved.proposalId);
 assert.equal(approved.changes.length,2);
 assert.match(approved.preview,/#fixed-a/);
 assert.match(approved.preview,/#fixed-b/);
 assert.equal(await readFile(sourcePath,'utf8'),source);
 await assert.rejects(readFile(join(managedRoot,'managed','batch-safe','current.user.js')),/ENOENT/);
 const applied=await workflow.applyBatch({proposalId:approved.proposalId,approved:true});
 assert.equal(applied.hash,approved.proposedHash);
 assert.match(await readFile(applied.managedPath,'utf8'),/#fixed-a/);
 assert.match(await readFile(applied.managedPath,'utf8'),/#fixed-b/);
 assert.equal(await readFile(join(managedRoot,'managed','batch-safe','current.user.js'),'utf8'),
  await readFile(applied.managedPath,'utf8'));
 assert.equal(await readFile(sourcePath,'utf8'),source);
 await assert.rejects(workflow.applyBatch({proposalId:approved.proposalId,approved:true}),/not found|stale/i);
}));
test('batch workflow refuses stale source, duplicate apply, missing approval and independently concurrent proposals',async()=>fixture(async({sourcePath,managedRoot})=>{
 const workflow=createBatchRepairWorkflow({managedRoot});
 const first=await workflow.proposeBatch({sourcePath,scriptId:'same-script',changes});
 const second=await workflow.proposeBatch({sourcePath,scriptId:'same-script',changes:changes.map(x=>({...x,newSelector:x.newSelector+'-second'}))});
 await assert.rejects(workflow.applyBatch({proposalId:first.proposalId,approved:false}),/approval/i);
 const result=await workflow.applyBatch({proposalId:first.proposalId,approved:true});
 assert.match(await readFile(result.managedPath,'utf8'),/#fixed-a/);
 await assert.rejects(workflow.applyBatch({proposalId:second.proposalId,approved:true}),/stale|not found|proposal/i);
 const refreshed=await workflow.proposeBatch({sourcePath,scriptId:'same-script',changes:[
  {oldSelector:'#fixed-a',newSelector:'#final-a',selectorLocation:{method:'querySelector',line:1,column:1}},
  {oldSelector:'#fixed-b',newSelector:'#final-b',selectorLocation:{method:'querySelector',line:2,column:1}},
 ]});
 assert.ok(refreshed.proposedHash!==first.proposedHash);
 const final=await workflow.applyBatch({proposalId:refreshed.proposalId,approved:true});
 assert.match(await readFile(final.managedPath,'utf8'),/#final-a/);
 assert.doesNotMatch(await readFile(final.managedPath,'utf8'),/#fixed-a/);
 assert.equal(await readFile(sourcePath,'utf8'),source);
}));
test('externally mutated original or managed current blocks batch apply and never overwrites it',async()=>fixture(async({sourcePath,managedRoot})=>{
 const workflow=createBatchRepairWorkflow({managedRoot});
 const preview=await workflow.proposeBatch({sourcePath,scriptId:'external',changes});
 await writeFile(sourcePath,source+'// external edit\n');
 await assert.rejects(workflow.applyBatch({proposalId:preview.proposalId,approved:true}),/hash|changed|stale/i);
 assert.match(await readFile(sourcePath,'utf8'),/external edit/);
}));
test('explicit pending batch discard and global invalidation revoke unapproved previews',async()=>fixture(async({sourcePath,managedRoot})=>{
 const workflow=createBatchRepairWorkflow({managedRoot});
 const a=await workflow.proposeBatch({sourcePath,scriptId:'cancelled',changes});
 assert.equal(workflow.discard(a.proposalId),true);
 assert.equal(workflow.discard(a.proposalId),false);
 await assert.rejects(workflow.applyBatch({proposalId:a.proposalId,approved:true}),/proposal|not found|expired/i);
 const b=await workflow.proposeBatch({sourcePath,scriptId:'cancelled',changes});
 workflow.invalidatePending();
 await assert.rejects(workflow.applyBatch({proposalId:b.proposalId,approved:true}),/proposal|not found|expired/i);
}));
