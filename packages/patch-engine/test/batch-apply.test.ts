import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {applyManagedPatchBatch,proposeLiteralPatchBatch} from '../src/index.ts';
import {activateManagedRevision} from '../../repair-workflow/src/history.ts';

const original='document.querySelector("#a");\ndocument.querySelector("#b");\n';
const changes=[
 {oldSelector:'#a',newSelector:'#new-a',selectorLocation:{method:'querySelector',line:1,column:1}},
 {oldSelector:'#b',newSelector:'#new-b',selectorLocation:{method:'querySelector',line:2,column:1}},
];
async function fixture(task:(ctx:{sourcePath:string;managedRoot:string;scriptId:string})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-batch-write-'));
 try{
  const sourcePath=join(root,'source.user.js'),managedRoot=join(root,'Data'),scriptId='batch-demo';
  await writeFile(sourcePath,original);await mkdir(managedRoot);
  await task({sourcePath,managedRoot,scriptId});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('batch immutable archives contain original and exact two-patch revision, without automatically changing active Data',async()=>fixture(async input=>{
 const before=await readFile(input.sourcePath);
 const draft=proposeLiteralPatchBatch({sourceBytes:before,changes});
 const saved=await applyManagedPatchBatch({...input,draft,expectedHash:draft.baseHash,approved:true});
 assert.deepEqual(await readFile(input.sourcePath),before);
 assert.deepEqual(await readFile(saved.backupPath),before);
 assert.equal(await readFile(saved.managedPath,'utf8'),draft.proposedSource);
 assert.equal(saved.hash,draft.proposedHash);
 await assert.rejects(readFile(join(input.managedRoot,'managed',input.scriptId,'current.user.js')),/ENOENT/);
 const activated=await activateManagedRevision({managedRoot:input.managedRoot,scriptId:input.scriptId,hash:saved.hash,approved:true,expectedCurrentHash:null});
 assert.equal(await readFile(activated.activePath,'utf8'),draft.proposedSource);
 assert.deepEqual(await readFile(input.sourcePath),before);
}));
test('batch writer requires explicit approval and rejects forged fully self-consistent draft revisions',async()=>fixture(async input=>{
 const originalBytes=await readFile(input.sourcePath);
 const draft=proposeLiteralPatchBatch({sourceBytes:originalBytes,changes});
 await assert.rejects(applyManagedPatchBatch({...input,draft,expectedHash:draft.baseHash,approved:false}),/approval/i);
 const fake={...draft,proposedSource:draft.proposedSource.replace('new-b','secret'),proposedHash:'a'.repeat(64)};
 await assert.rejects(applyManagedPatchBatch({...input,draft:fake,expectedHash:draft.baseHash,approved:true}),/draft|mismatch|reconstruct/i);
 await assert.rejects(readFile(join(input.managedRoot,'managed',input.scriptId,'current.user.js')),/ENOENT/);
}));
test('stale source hash blocks atomic batch archive and preserves externally changed original',async()=>fixture(async input=>{
 const draft=proposeLiteralPatchBatch({sourceBytes:await readFile(input.sourcePath),changes});
 await writeFile(input.sourcePath,'document.querySelector("#external-change");');
 await assert.rejects(applyManagedPatchBatch({...input,draft,expectedHash:draft.baseHash,approved:true}),/hash|stale|mismatch/i);
 assert.match(await readFile(input.sourcePath,'utf8'),/#external-change/);
}));
