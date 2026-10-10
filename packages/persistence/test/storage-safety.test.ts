import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrateDatabase,createScriptRepository,backupRegistryDatabase,type ScriptRecord} from '../src/index.ts';

const makeRecord=(id:string,path:string):ScriptRecord=>({
 id,path,displayName:'duplicate.user.js',sha256:'1'.repeat(64),
 healthStatus:'parsed',metadataJson:'{}',
 createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'
});

test('the persisted script ID cannot silently move to a distinct source path',()=>{
 const db=openDatabase(':memory:');
 try{
  migrateDatabase(db);
  const repo=createScriptRepository(db);
  repo.upsert(makeRecord('one','/folder-A/duplicate.user.js'));
  repo.upsert(makeRecord('two','/folder-B/duplicate.user.js'));
  assert.throws(()=>repo.upsert(makeRecord('one','/folder-C/duplicate.user.js')),/path|identity|conflict|rebind/i);
  assert.equal(repo.findIdByPath('/folder-A/duplicate.user.js'),'one');
  assert.equal(repo.findIdByPath('/folder-C/duplicate.user.js'),undefined);
  assert.equal(repo.list().length,2);
  repo.upsert({...makeRecord('one','/folder-A/duplicate.user.js'),sha256:'2'.repeat(64)});
  assert.equal(repo.list().find(x=>x.id==='one')?.sha256,'2'.repeat(64));
 }finally{db.close();}
});

test('repeat migration is idempotent and preserves distinct same-named scripts without rewriting their timestamps',()=>{
 const db=openDatabase(':memory:');
 try{
  migrateDatabase(db);
  const repo=createScriptRepository(db);
  repo.upsert(makeRecord('alpha','/a/duplicate.user.js'));
  repo.upsert(makeRecord('beta','/b/duplicate.user.js'));
  const original=repo.list();
  for(let i=0;i<5;i++)migrateDatabase(db);
  assert.deepEqual(createScriptRepository(db).list(),original);
  assert.equal(db.prepare('SELECT version FROM schema_version').get()?.version,1);
  assert.equal(db.prepare('SELECT version FROM schema_version').all().length,1);
 }finally{db.close();}
});

test('SQLite recovery backup refuses a destination hidden beneath a symlinked ancestor',async t=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-backup-parent-link-'));
 const db=openDatabase(join(root,'registry.sqlite'));migrateDatabase(db);
 try{
  const outside=join(root,'outside'),link=join(root,'link');
  await mkdir(outside);await mkdir(join(outside,'backups'));
  try{await symlink(outside,link,process.platform==='win32'?'junction':'dir');}
  catch(e){
   if(['EPERM','EACCES','ENOTSUP'].includes((e as NodeJS.ErrnoException).code??'')){
    t.skip('Directory links unavailable on this runner');return;
   }
   throw e;
  }
  await assert.rejects(backupRegistryDatabase(db,join(link,'backups','snapshot.sqlite')),/symlink|unsafe|directory/i);
  await assert.rejects(stat(join(outside,'backups','snapshot.sqlite')),{code:'ENOENT'});
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});

test('v1 schema rejects a NOCASE path uniqueness rule without rewriting existing records',()=>{
 const db=openDatabase(':memory:');
 try{
  // A schema with the expected columns and two UNIQUE indexes can still
  // collapse two different case-sensitive source paths via NOCASE.
  db.exec(`CREATE TABLE schema_version(version INTEGER NOT NULL);
   INSERT INTO schema_version VALUES(1);
   CREATE TABLE scripts(
    id TEXT PRIMARY KEY, path TEXT COLLATE NOCASE UNIQUE NOT NULL,
    display_name TEXT NOT NULL, sha256 TEXT NOT NULL,
    health_status TEXT NOT NULL, metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   );`);
  const repo=createScriptRepository(db);
  repo.upsert(makeRecord('first','/scripts/Case.user.js'));
  assert.throws(()=>repo.upsert(makeRecord('second','/scripts/case.user.js')),/constraint|unique/i,
   'NOCASE demonstrates that the existing layout collapses distinct source paths');
  assert.throws(()=>migrateDatabase(db),/collat|binary|unique|schema|incompatible/i,
   'a v1 migration must reject incompatible case-insensitive path uniqueness');
  assert.equal(db.prepare('SELECT version FROM schema_version').get()?.version,1);
  assert.deepEqual(repo.list().map(x=>[x.id,x.path]),[['first','/scripts/Case.user.js']]);
 }finally{db.close();}
});

test('normal v1 registry retains distinct paths differing only by case',()=>{
 const db=openDatabase(':memory:');
 try{
  migrateDatabase(db);
  const repo=createScriptRepository(db);
  repo.upsert(makeRecord('upper','/scripts/Case.user.js'));
  repo.upsert(makeRecord('lower','/scripts/case.user.js'));
  migrateDatabase(db);
  assert.equal(repo.findIdByPath('/scripts/Case.user.js'),'upper');
  assert.equal(repo.findIdByPath('/scripts/case.user.js'),'lower');
  assert.equal(repo.list().length,2);
 }finally{db.close();}
});
