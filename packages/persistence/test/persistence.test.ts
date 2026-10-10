import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,migrateDatabase,createScriptRepository} from '../src/index.ts';
import * as persistence from '../src/index.ts';

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


test('version 1 migration rejects missing unique script path constraint without deleting duplicate legacy rows',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-nonunique-v1-'));
 const file=join(dir,'registry.sqlite');
 try{
  const {DatabaseSync}=await import('node:sqlite');
  const old=new DatabaseSync(file);
  old.exec(`CREATE TABLE schema_version(version INTEGER NOT NULL);
   INSERT INTO schema_version VALUES (1);
   CREATE TABLE scripts(
    id TEXT PRIMARY KEY,path TEXT NOT NULL,display_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,health_status TEXT NOT NULL,metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL
   );`);
  old.prepare('INSERT INTO scripts VALUES (?,?,?,?,?,?,?,?)').run('one','/shared/file.user.js','a','a','parsed','{}','date','date');
  old.prepare('INSERT INTO scripts VALUES (?,?,?,?,?,?,?,?)').run('two','/shared/file.user.js','b','b','parsed','{}','date','date');
  old.close();
  const db=openDatabase(file);
  try{assert.throws(()=>migrateDatabase(db),/unique|constraint|schema|incompatible/i);}
  finally{db.close();}
  const inspect=new DatabaseSync(file);
  try{
   assert.equal(inspect.prepare("SELECT count(*) AS count FROM scripts WHERE path='/shared/file.user.js'").get()?.count,2);
   assert.equal(inspect.prepare('SELECT version FROM schema_version').get()?.version,1);
  }finally{inspect.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});


test('consistent SQLite registry backup includes committed WAL data and verifies its SHA-256',async()=>{
 const backupRegistryDatabase=(persistence as unknown as {backupRegistryDatabase?:(
  db:ReturnType<typeof openDatabase>,destination:string
 )=>Promise<{path:string;sha256:string;bytes:number}>}).backupRegistryDatabase;
 assert.equal(typeof backupRegistryDatabase,'function','consistent hot-backup API must exist');
 const dir=await mkdtemp(join(tmpdir(),'usshm-live-backup-'));
 try{
  const file=join(dir,'registry.sqlite'),destination=join(dir,'backup.sqlite');
  const db=openDatabase(file);
  try{
   migrateDatabase(db);
   const repo=createScriptRepository(db);
   repo.upsert({id:'one',path:'/scripts/one.user.js',displayName:'one',
    sha256:'a'.repeat(64),healthStatus:'parsed',metadataJson:'{}',
    createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'});
   const result=await backupRegistryDatabase!(db,destination);
   assert.equal(result.path,destination);
   assert.match(result.sha256,/^[0-9a-f]{64}$/);
   assert.ok(result.bytes>0);
   const {DatabaseSync}=await import('node:sqlite');
   const backup=new DatabaseSync(destination,{readOnly:true});
   try{
    assert.equal(backup.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
    assert.equal(backup.prepare('SELECT count(*) AS c FROM scripts').get()?.c,1);
    assert.equal(backup.prepare("SELECT id FROM scripts WHERE path='/scripts/one.user.js'").get()?.id,'one');
   }finally{backup.close();}
   const {createHash}=await import('node:crypto');
   const {readFile}=await import('node:fs/promises');
   assert.equal(createHash('sha256').update(await readFile(destination)).digest('hex'),result.sha256);
   await assert.rejects(backupRegistryDatabase!(db,destination),/exist|overwrite|unsafe|refus/i);
  }finally{db.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('registry hot-backup refuses non-absolute and non-sqlite destinations before writing',async()=>{
 const action=(persistence as unknown as {backupRegistryDatabase?:(
  db:ReturnType<typeof openDatabase>,destination:string
 )=>Promise<unknown>}).backupRegistryDatabase;
 assert.equal(typeof action,'function');
 const dir=await mkdtemp(join(tmpdir(),'usshm-backup-invalid-'));
 try{
  const db=openDatabase(join(dir,'registry.sqlite'));
  try{
   migrateDatabase(db);
   await assert.rejects(action!(db,'relative.sqlite'),/absolute|path/i);
   await assert.rejects(action!(db,join(dir,'registry.sqlite')),/exist|overwrite|unsafe|source/i);
   await assert.rejects(action!(db,join(dir,'backup.json')),/sqlite|extension|path/i);
  }finally{db.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});


test('v1 SQLite schema with unrecognized mutating triggers is rejected before future upserts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-triggered-db-'));
 const file=join(dir,'registry.sqlite');
 try{
  const db=openDatabase(file);
  migrateDatabase(db);
  db.exec("CREATE TRIGGER purge_scripts AFTER INSERT ON scripts BEGIN DELETE FROM scripts; END");
  db.close();
  const reopened=openDatabase(file);
  try{assert.throws(()=>migrateDatabase(reopened),/trigger|schema|unsafe|unknown/i);}
  finally{reopened.close();}
  const {DatabaseSync}=await import('node:sqlite');
  const inspect=new DatabaseSync(file);
  try{
   assert.equal(inspect.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='trigger' AND name='purge_scripts'").get()?.c,1,
    'reject unknown trigger without silently deleting or rewriting the database');
  }finally{inspect.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});


test('online SQLite registry backup publishes a self-contained file with no persistent WAL or staging sidecars',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-backup-sidecars-'));
 try{
  const source=join(dir,'registry.sqlite'),destination=join(dir,'export.sqlite');
  const db=openDatabase(source);migrateDatabase(db);
  try{
   const receipt=await persistence.backupRegistryDatabase(db,destination);
   assert.equal(receipt.path,destination);
   const names=await readdir(dir);
   assert.ok(names.includes('export.sqlite'));
   assert.equal(names.filter(name=>
    name==='export.sqlite-wal'||name==='export.sqlite-shm'||
    /^\.usshm-backup-.*\.tmp(?:-wal|-shm)?$/.test(name)).length,0,
    'backed-up SQLite file must not require sidecars or leave staging data');
   const {DatabaseSync}=await import('node:sqlite');
   const detached=new DatabaseSync(destination,{readOnly:true});
   try{
    assert.equal(detached.prepare('PRAGMA journal_mode').get()?.journal_mode,'delete');
    assert.equal(detached.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
   }finally{detached.close();}
   assert.equal((await readdir(dir)).filter(name=>name.startsWith('export.sqlite-')).length,0);
  }finally{db.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
