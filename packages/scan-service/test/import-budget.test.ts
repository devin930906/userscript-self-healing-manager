import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runStaticScan} from '../src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../persistence/src/index.ts';

test('expanded directory scan fails before touching the registry if the file budget is exceeded',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-budget-'));
 const db=openDatabase(':memory:');migrateDatabase(db);const repository=createScriptRepository(db);
 try {
  const names=['one.user.js','two.user.js','three.user.js'];
  for(const name of names)await writeFile(join(root,name),'document.querySelector("#safe");');
  await assert.rejects(runStaticScan({paths:[root],recursive:true,maxFiles:2},{repository}),/limit-exceeded/);
  assert.equal(repository.list().length,0,'over-budget scans must never partially register files');
  assert.equal(await readFile(join(root,names[0]!),'utf8'),'document.querySelector("#safe");');
 } finally {db.close();await rm(root,{recursive:true,force:true});}
});

test('a mixed file and directory selection uses a single shared scan budget',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-shared-budget-'));
 const db=openDatabase(':memory:');migrateDatabase(db);const repository=createScriptRepository(db);
 try {
  const a=join(root,'a.user.js'),b=join(root,'b.user.js');
  await writeFile(a,'document.querySelector("#a");');
  await writeFile(b,'document.querySelector("#b");');
  await assert.rejects(runStaticScan({paths:[a,root],recursive:true,maxFiles:2},{repository}),/limit-exceeded/);
  assert.equal(repository.list().length,0,'do not import any script on budget failure');
 } finally {db.close();await rm(root,{recursive:true,force:true});}
});
