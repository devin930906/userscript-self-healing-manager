import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {runStaticScan} from '../src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../persistence/src/index.ts';

test('scan returns independent statuses and correct batch statistics',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-batch-'));
 try {const files=['good.user.js','dynamic.user.js','bad.user.js'];
 await writeFile(join(root,files[0]!),'document.querySelector("#save");');
 await writeFile(join(root,files[1]!),'document.querySelector(`#${id}`);');
 await writeFile(join(root,files[2]!),'const (=');
 const db=openDatabase(':memory:');migrateDatabase(db);
 const r=await runStaticScan({paths:files.map(x=>join(root,x)),recursive:false,maxFiles:1000},{repository:createScriptRepository(db)});
 assert.equal(r.processedCount,3);assert.equal(r.passedCount,2);assert.equal(r.errorCount,1);
 assert.deepEqual(r.items.map(x=>x.status),['parsed','parsed','parse-error']);assert.equal(r.items[1]?.runtimeRequiredCount,1);db.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
test('limit triggers explicit blocking error',async()=>{
 const db=openDatabase(':memory:');migrateDatabase(db);
 await assert.rejects(runStaticScan({paths:['one.user.js','two.user.js'],recursive:false,maxFiles:1},{repository:createScriptRepository(db)}),/limit-exceeded/);db.close();
});
