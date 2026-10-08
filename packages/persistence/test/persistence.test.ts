import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,migrateDatabase,createScriptRepository} from '../src/index.ts';

test('migration is idempotent, save/list persists across reopen',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-db-'));const file=join(dir,'state.sqlite');
 try {
  let db=openDatabase(file);migrateDatabase(db);migrateDatabase(db);
  let repo=createScriptRepository(db);
  repo.upsert({id:'1',path:'/one/a.user.js',displayName:'a',sha256:'one',healthStatus:'parsed',metadataJson:'{}',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'});
  repo.upsert({id:'2',path:'/two/a.user.js',displayName:'a',sha256:'two',healthStatus:'parse-error',metadataJson:'{}',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'});
  assert.equal(repo.list().length,2);db.close();
  db=openDatabase(file);migrateDatabase(db);repo=createScriptRepository(db);
  assert.equal(repo.list().length,2);assert.deepEqual(repo.list().map(x=>x.id),['1','2']);db.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
