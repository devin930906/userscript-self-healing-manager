import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrateDatabase,openDatabase} from '../src/index.ts';

test('Task4 rejects versioned WITHOUT ROWID registry and retains row and reusable handle',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-task4-without-rowid-'));
 const file=join(dir,'registry.sqlite');
 try{
  const fixture=new DatabaseSync(file);
  try{
   fixture.exec(`CREATE TABLE schema_version(version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES(1);
    CREATE TABLE scripts(
     id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,
     sha256 TEXT NOT NULL,health_status TEXT NOT NULL,metadata_json TEXT NOT NULL,
     created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    ) WITHOUT ROWID;`);
   fixture.prepare('INSERT INTO scripts VALUES(?,?,?,?,?,?,?,?)').run(
    'original','/original.user.js','original','sha','parsed','{}','old','old');
  }finally{fixture.close();}
  const db=openDatabase(file);
  try{
   assert.throws(()=>migrateDatabase(db),/schema|incompatible|without rowid|unsupported/i);
   assert.equal(db.prepare("SELECT display_name FROM scripts WHERE id='original'").get()?.display_name,'original');
   assert.equal(db.prepare("SELECT wr FROM pragma_table_list WHERE name='scripts'").get()?.wr,1);
   assert.equal(db.prepare('SELECT version FROM schema_version').get()?.version,1);
   db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK');
  }finally{db.close();}
  const persisted=new DatabaseSync(file,{readOnly:true});
  try{assert.equal(persisted.prepare("SELECT display_name FROM scripts WHERE id='original'").get()?.display_name,'original');}
  finally{persisted.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
