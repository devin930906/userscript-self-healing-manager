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


test('unversioned existing scripts data is never claimed or silently migrated as schema v1',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-unversioned-'));
 const file=join(dir,'registry.sqlite');
 try{
  const {DatabaseSync}=await import('node:sqlite');
  const unknown=new DatabaseSync(file);
  unknown.exec("CREATE TABLE scripts(id TEXT PRIMARY KEY, legacy_payload TEXT NOT NULL)");
  unknown.prepare("INSERT INTO scripts VALUES (?,?)").run('important','preserve-this-data');
  unknown.close();
  const db=openDatabase(file);
  try{assert.throws(()=>migrateDatabase(db),/unversioned|unknown|schema|migration/i);}
  finally{db.close();}
  const verify=new DatabaseSync(file);
  try{
   assert.equal(verify.prepare("SELECT legacy_payload AS value FROM scripts WHERE id='important'").get()?.value,'preserve-this-data');
   assert.equal(verify.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='schema_version'").get()?.count,0);
  }finally{verify.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('existing v1 schema marker never silently recreates a missing scripts table',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-missing-table-'));
 const file=join(dir,'registry.sqlite');
 try{
  const {DatabaseSync}=await import('node:sqlite');
  const unknown=new DatabaseSync(file);
  unknown.exec("CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1)");
  unknown.close();
  const db=openDatabase(file);
  try{assert.throws(()=>migrateDatabase(db),/missing|schema|invalid|corrupt/i);}
  finally{db.close();}
  const verify=new DatabaseSync(file);
  try{
   assert.equal(verify.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='scripts'").get()?.count,0);
   assert.equal(verify.prepare("SELECT version FROM schema_version").get()?.version,1);
  }finally{verify.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('versioned database with incompatible scripts columns is rejected without data loss',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-bad-schema-'));
 const file=join(dir,'registry.sqlite');
 try{
  const {DatabaseSync}=await import('node:sqlite');
  const unknown=new DatabaseSync(file);
  unknown.exec("CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES(1); CREATE TABLE scripts(id TEXT PRIMARY KEY, path TEXT, private_payload TEXT NOT NULL); INSERT INTO scripts VALUES('important','/temp/a','do-not-lose')");
  unknown.close();
  const db=openDatabase(file);
  try{assert.throws(()=>migrateDatabase(db),/columns|schema|incompatible|invalid/i);}
  finally{db.close();}
  const verify=new DatabaseSync(file);
  try{assert.equal(verify.prepare("SELECT private_payload AS value FROM scripts WHERE id='important'").get()?.value,'do-not-lose');}
  finally{verify.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
