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
