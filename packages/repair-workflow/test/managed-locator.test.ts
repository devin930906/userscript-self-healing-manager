import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRepairWorkflow} from '../src/index.ts';
import {readVerifiedManagedLocator} from '../src/managed-locator.ts';

async function fixture(run:(root:string,sourcePath:string,flow:ReturnType<typeof createRepairWorkflow>)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'usshm-verify-managed-'));
 const root=join(directory,'Data'),sourcePath=join(directory,'original.user.js');
 await writeFile(sourcePath,'// ==UserScript==\n// @name Fixture\n// @match https://example.org/*\n// ==/UserScript==\ndocument.querySelector("#old");\n');
 try{await run(root,sourcePath,createRepairWorkflow({managedRoot:root}));}
 finally{await rm(directory,{recursive:true,force:true});}
}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

test('verified applied managed current exposes the actual patched literal for subsequent V1 DOM testing',async()=>fixture(async(root,source,flow)=>{
 const before=await readFile(source);
 const proposal=await flow.propose({sourcePath:source,scriptId:'v1-managed',oldSelector:'#old',newSelector:'#safeNew'});
 const saved=await flow.apply({proposalId:proposal.proposalId,approved:true});
 const result=await readVerifiedManagedLocator({managedRoot:root,scriptId:'v1-managed',
  revisionHash:saved.hash,selectorIndex:0});
 assert.deepEqual(result,{method:'querySelector',expression:'#safeNew',
  runtimeRequired:false,revisionHash:saved.hash,validationLevel:'managed-static-only'});
 assert.deepEqual(await readFile(source),before,'original userscript must never change');
}));

test('post-apply DOM check rejects stale revision hash and unmanaged current mutations',async()=>fixture(async(root,source,flow)=>{
 const proposal=await flow.propose({sourcePath:source,scriptId:'v1-stale',oldSelector:'#old',newSelector:'#new'});
 const saved=await flow.apply({proposalId:proposal.proposalId,approved:true});
 await assert.rejects(readVerifiedManagedLocator({managedRoot:root,scriptId:'v1-stale',
  revisionHash:sha(Buffer.from('unrelated')),selectorIndex:0}),/hash|stale|current|revision/i);
 await writeFile(join(root,'managed','v1-stale','current.user.js'),'document.querySelector("#hijacked");');
 await assert.rejects(readVerifiedManagedLocator({managedRoot:root,scriptId:'v1-stale',
  revisionHash:saved.hash,selectorIndex:0}),/hash|stale|current|revision|external/i);
}));

test('rollback to archived original cannot be misrepresented as the approved patched revision',async()=>fixture(async(root,source,flow)=>{
 const original=await readFile(source);
 const proposal=await flow.propose({sourcePath:source,scriptId:'v1-rollback',oldSelector:'#old',newSelector:'#new'});
 const saved=await flow.apply({proposalId:proposal.proposalId,approved:true});
 await flow.restore({scriptId:'v1-rollback',hash:sha(original),approved:true});
 await assert.rejects(readVerifiedManagedLocator({managedRoot:root,scriptId:'v1-rollback',
  revisionHash:saved.hash,selectorIndex:0}),/hash|stale|current|revision/i);
}));

test('no patched revision, unsafe index, unknown method or symlinked current is never trusted',async(t)=>fixture(async(root,source,flow)=>{
 await assert.rejects(readVerifiedManagedLocator({managedRoot:root,scriptId:'not-created',
  revisionHash:'f'.repeat(64),selectorIndex:0}),/current|revision|missing|not found|directory/i);
 const proposal=await flow.propose({sourcePath:source,scriptId:'v1-bounds',oldSelector:'#old',newSelector:'#new'});
 const saved=await flow.apply({proposalId:proposal.proposalId,approved:true});
 for(const selectorIndex of [-1,300,0.1]){
  await assert.rejects(readVerifiedManagedLocator({managedRoot:root,scriptId:'v1-bounds',
   revisionHash:saved.hash,selectorIndex}),/index|selector|bounds|invalid/i);
 }
 const current=join(root,'managed','v1-bounds','current.user.js');
 await rm(current);
 try{await symlink(source,current);}catch(e){
  if(['EPERM','EACCES','ENOTSUP'].includes((e as NodeJS.ErrnoException).code??'')){t.skip('No symlink privileges');return;}
  throw e;
 }
 await assert.rejects(readVerifiedManagedLocator({managedRoot:root,scriptId:'v1-bounds',
  revisionHash:saved.hash,selectorIndex:0}),/current|symlink|unsafe/i);
}));

test('checked current needs a matching immutable revision archive, not merely user-supplied matching SHA',async()=>fixture(async(root,source,flow)=>{
 const proposal=await flow.propose({sourcePath:source,scriptId:'v1-archive',oldSelector:'#old',newSelector:'#new'});
 const saved=await flow.apply({proposalId:proposal.proposalId,approved:true});
 const {unlink}=await import('node:fs/promises');
 await unlink(join(root,'managed','v1-archive','revision-'+saved.hash+'.user.js'));
 await assert.rejects(readVerifiedManagedLocator({managedRoot:root,scriptId:'v1-archive',
  revisionHash:saved.hash,selectorIndex:0}),/archive|revision|missing|not found|hash/i);
}));
