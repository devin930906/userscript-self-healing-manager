import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,link,symlink,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openAuditJournal} from '../src/index.ts';

async function sandbox(run:(root:string)=>Promise<void>):Promise<void>{
 const root=await mkdtemp(join(tmpdir(),'usshm-audit-alias-'));
 try{await run(root)}finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06 refuses a hardlinked audit SQLite database before any initialization write',async()=>sandbox(async root=>{
 const original=join(root,'external-audit.sqlite');
 const journal=openAuditJournal(original);journal.close();
 const initial=await readFile(original);
 const dataRoot=join(root,'Data');await mkdir(dataRoot);
 await link(original,join(dataRoot,'audit-journal.sqlite'));
 assert.throws(()=>openAuditJournal(join(dataRoot,'audit-journal.sqlite')),
  /unsafe|alias|hardlink|link count/i,
  'an app-owned audit name must never authorize writing a separate inode alias');
 assert.deepEqual(await readFile(original),initial,
  'rejecting an alias must not mutate the independent original database');
}));

test('RG-06 refuses a linked audit database leaf, preserving the external SQLite file',async t=>sandbox(async root=>{
 const original=join(root,'external-audit.sqlite');
 const journal=openAuditJournal(original);journal.close();
 const initial=await readFile(original);
 const dataRoot=join(root,'Data');await mkdir(dataRoot);
 try{await symlink(original,join(dataRoot,'audit-journal.sqlite'),'file');}
 catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('platform cannot create file symlink');return;}throw error;}
 assert.throws(()=>openAuditJournal(join(dataRoot,'audit-journal.sqlite')),
  /unsafe|symlink|alias|linked/i);
 assert.deepEqual(await readFile(original),initial);
}));

test('RG-06 refuses redirected Data ancestors before opening an audit journal',async t=>sandbox(async root=>{
 const foreign=join(root,'foreign-data'),linked=join(root,'linked-data');
 await mkdir(foreign);
 try{await symlink(foreign,linked,'dir');}
 catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('platform cannot create directory symlink');return;}throw error;}
 assert.throws(()=>openAuditJournal(join(linked,'audit-journal.sqlite')),
  /unsafe|symlink|junction|linked|directory/i);
 assert.rejects(readFile(join(foreign,'audit-journal.sqlite')),{code:'ENOENT'});
}));

test('RG-06 refuses an existing SQLite WAL or shared-memory symlink before startup',async t=>sandbox(async root=>{
 const dataRoot=join(root,'Data');await mkdir(dataRoot);
 const path=join(dataRoot,'audit-journal.sqlite');
 const journal=openAuditJournal(path);journal.close();
 const independent=join(root,'external-sidecar');
 await writeFile(independent,'independent-owner');
 const suffixes=['-wal','-shm','-journal'];
 for(const suffix of suffixes){
  const alias=path+suffix;
  try{await symlink(independent,alias,'file');}
  catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('platform cannot create SQLite sidecar symlink');return;}throw error;}
  try{assert.throws(()=>openAuditJournal(path),/unsafe|symlink|alias|sidecar|linked/i);}
  finally{await rm(alias,{force:true});}
 }
 assert.equal(await readFile(independent,'utf8'),'independent-owner');
}));
