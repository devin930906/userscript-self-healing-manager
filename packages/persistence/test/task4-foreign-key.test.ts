import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,migrateDatabase} from '../src/index.ts';

test('Task 4: reject v1 registry with unexpected foreign key before any registry writes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-task4-foreign-key-'));
 const path=join(dir,'registry.sqlite');
 try{
  const injected=new DatabaseSync(path);
  try{
   injected.exec(`CREATE TABLE schema_version(version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES(1);
    CREATE TABLE dependencies(path TEXT PRIMARY KEY);
    CREATE TABLE scripts(
      id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL REFERENCES dependencies(path),
      display_name TEXT NOT NULL, sha256 TEXT NOT NULL,
      health_status TEXT NOT NULL, metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO dependencies VALUES('/safe/existing.user.js');
    INSERT INTO scripts VALUES('existing','/safe/existing.user.js','keep','hash','parsed','{}','t','t');`);
  }finally{injected.close();}
  const db=openDatabase(path);
  try{
   assert.throws(()=>migrateDatabase(db),/foreign.key|schema|incompatible|unsafe/i,
    'unexpected FK changes v1 upsert semantics and must fail closed');
  }finally{db.close();}
  const check=new DatabaseSync(path,{readOnly:true});
  try{
   assert.equal(check.prepare("SELECT id FROM scripts WHERE path='/safe/existing.user.js'").get()?.id,'existing');
   assert.equal(check.prepare('SELECT version FROM schema_version').get()?.version,1);
   assert.equal(check.prepare('SELECT count(*) AS n FROM pragma_foreign_key_list(\'scripts\')').get()?.n,1);
  }finally{check.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
