import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {migrateDatabase,openDatabase,createScriptRepository} from '../src/index.ts';

const tables=(db:DatabaseSync)=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((x:any)=>x.name);

test('future database version is rejected before creating any tables or mutating existing data',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES(999);');
  db.exec('CREATE TABLE future_schema(secret TEXT); INSERT INTO future_schema VALUES (\'preserve-me\');');
  const before=tables(db);
  assert.throws(()=>migrateDatabase(db),/unsupported|newer|version/i);
  assert.deepEqual(tables(db),before,'older binary must not create scripts table in a newer schema');
  assert.equal(db.prepare('SELECT secret FROM future_schema').get()?.secret,'preserve-me');
  assert.equal(db.prepare('SELECT version FROM schema_version').get()?.version,999);
 }finally{db.close();}
});

test('uninitialized version table is treated as corruption rather than silently upgraded',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE schema_version(version INTEGER NOT NULL)');
  assert.throws(()=>migrateDatabase(db),/version|corrupt|schema/i);
  assert.deepEqual(tables(db),['schema_version']);
 }finally{db.close();}
});

test('mixed old and new schema version rows must refuse downgrade without modifying scripts',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES(1),(42);');
  assert.throws(()=>migrateDatabase(db),/unsupported|newer|version/i);
  assert.deepEqual(tables(db),['schema_version']);
  assert.deepEqual(db.prepare('SELECT version FROM schema_version ORDER BY version').all().map(x=>x.version),[1,42]);
 }finally{db.close();}
});

test('fresh database creation and unchanged version-one reopen remain supported',()=>{
 const db=openDatabase(':memory:');
 try{
  migrateDatabase(db);
  migrateDatabase(db);
  assert.deepEqual(tables(db),['schema_version','scripts']);
  assert.equal(db.prepare('SELECT version FROM schema_version').get()?.version,1);
  assert.deepEqual(createScriptRepository(db).list(),[]);
 }finally{db.close();}
});
