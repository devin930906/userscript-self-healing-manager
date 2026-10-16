import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rename,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishExclusiveExport} from '../src/export.ts';

async function withDestination(run:(root:string,destination:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-postlink-export-'));
 try{await run(root,join(root,'approved.user.js'));}
 finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06 post-link publication failure withdraws only our own installable export',async()=>withDestination(async(root,destination)=>{
 const approved=Buffer.from('// fixed synthetic approved userscript');
 let invoked=0;
 await assert.rejects(publishExclusiveExport({
  destinationPath:destination,bytes:approved,
  afterLink:async()=>{
   invoked++;
   assert.deepEqual(await readFile(destination),approved,'the link must exist before fault injection');
   throw new Error('synthetic post-link acknowledgement failure');
  },
 }),/synthetic post-link acknowledgement failure/);
 assert.equal(invoked,1);
 await assert.rejects(readFile(destination),{code:'ENOENT'},
  'failed publication must not leave an installable .user.js behind');
 assert.deepEqual((await readdir(root)).filter(name=>name.includes('.staging-')),[],
  'failed publication must not leak staging copies');
}));

test('RG-06 post-link destination substitution never authorizes deleting the competing file',async()=>withDestination(async(root,destination)=>{
 const approved=Buffer.from('// original approved synthetic userscript');
 const competitor=Buffer.from('// another writer: preserve this file');
 const displaced=join(root,'displaced-approved.user.js');
 await assert.rejects(publishExclusiveExport({
  destinationPath:destination,bytes:approved,
  afterLink:async()=>{
   assert.deepEqual(await readFile(destination),approved);
   await rename(destination,displaced);
   await writeFile(destination,competitor);
   throw new Error('synthetic concurrent destination replacement');
  },
 }),/synthetic concurrent destination replacement/);
 assert.deepEqual(await readFile(destination),competitor,
  'rollback must never delete another writer\'s destination');
 assert.deepEqual(await readFile(displaced),approved,
  'the approved original link is no longer ours to remove by its old pathname');
 assert.deepEqual((await readdir(root)).filter(name=>name.includes('.staging-')),[]);
}));

test('RG-06 identity-check failure cannot delete a substituted destination already observed by lstat',async()=>withDestination(async(root,destination)=>{
 const approved=Buffer.from('// approved installed bytes');
 const competitor=Buffer.from('// exact other-writer file stays');
 const displaced=join(root,'moved-approved.user.js');
 await assert.rejects(publishExclusiveExport({
  destinationPath:destination,bytes:approved,
  afterLink:async()=>{
   await rename(destination,displaced);
   await writeFile(destination,competitor);
   // No synthetic exception: the production native identity check itself
   // must reject this replacement, without treating it as owned for rollback.
  },
 }),/identity changed|unsafe|replaced/i);
 assert.deepEqual(await readFile(destination),competitor,
  'a failed native identity check must not unlink the other writer');
 assert.deepEqual(await readFile(displaced),approved);
 assert.deepEqual((await readdir(root)).filter(name=>name.includes('.staging-')),[]);
}));

test('RG-06 post-verification same-byte destination substitution is not a successful export',async()=>withDestination(async(root,destination)=>{
 const approved=Buffer.from('// approved synthetic bytes that an attacker can duplicate');
 const displaced=join(root,'displaced-published.user.js');
 let injected=false;
 // Deliberately inject AFTER the first published inode lstat but BEFORE
 // the content-pinned reader. A same-byte replacement can satisfy SHA256
 // while no longer referring to the inode created by this export.
 const attempt={
  destinationPath:destination,bytes:approved,
  afterPublishedStat:async()=>{
   injected=true;
   await rename(destination,displaced);
   await writeFile(destination,approved);
  },
 };
 await assert.rejects(publishExclusiveExport(attempt),/identity changed|unsafe|replaced/i,
  'identical bytes must not certify a competing inode as our export');
 assert.equal(injected,true,'test must exercise the post-stat window');
 assert.deepEqual(await readFile(destination),approved,
  'failed export must not delete the competing same-byte destination');
 assert.deepEqual(await readFile(displaced),approved,
  'the original linked bytes were displaced, not automatically deleted');
 assert.deepEqual((await readdir(root)).filter(name=>name.includes('.staging-')),[]);
}));
