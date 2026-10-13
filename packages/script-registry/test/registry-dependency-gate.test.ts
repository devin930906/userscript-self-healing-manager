import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {importPaths} from '../src/index.ts';
import {runStaticScan} from '../../scan-service/src/index.ts';
import {createScriptRepository,migrateDatabase,openDatabase} from '../../persistence/src/index.ts';

test('RG-01 reject missing registry capability at both public entrypoints before importing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-invalid-repository-'));
 const db=openDatabase(':memory:');
 migrateDatabase(db);
 const repository=createScriptRepository(db);
 const path=join(root,'source.user.js');
 const original=Buffer.from('const a = document.querySelector("#safe");\n');
 const malformed=[undefined,null,{},{
  findIdByPath:(_path:string)=>undefined,
 },{
  upsert:(_record:unknown)=>{},
 }];
 try{
  await writeFile(path,original);
  for(const invalid of malformed){
   await assert.rejects(importPaths({
    paths:[path],recursive:false,repository:invalid as Parameters<typeof importPaths>[0]['repository'],maxFiles:2,
   }),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid script import repository');
    return true;
   });
   await assert.rejects(runStaticScan({paths:[path],recursive:false,maxFiles:2},{
    repository:invalid as Parameters<typeof runStaticScan>[1]['repository'],
   }),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid static scan repository');
    return true;
   });
   assert.equal(repository.list().length,0,'invalid dependency must not import any scripts');
   assert.deepEqual(await readFile(path),original,'never change original scripts');
  }
  for(const invalid of [null,undefined,{}]){
   await assert.rejects(runStaticScan({paths:[path],recursive:false,maxFiles:2},
    invalid as Parameters<typeof runStaticScan>[1]),/Invalid static scan repository/);
  }
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});

test('RG-01 genuine SQLite registry is accepted for direct import and static scan',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-valid-repository-'));
 const db=openDatabase(':memory:');
 migrateDatabase(db);
 try{
  const path=join(root,'ok.user.js');
  await writeFile(path,'document.querySelector("#ok");');
  const repository=createScriptRepository(db);
  const first=await importPaths({paths:[path],recursive:false,repository,maxFiles:3});
  assert.equal(first[0]?.status,'imported');
  const scan=await runStaticScan({paths:[path],recursive:false,maxFiles:3},{repository});
  assert.equal(scan.scanMode,'static-only');
  assert.equal(scan.passedCount,1);
  assert.equal(scan.errorCount,0);
  assert.equal(repository.list().length,1);
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
