import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrateDatabase} from '../src/index.ts';

test('Task4 migration rejects hidden generated v1 script columns and leaves connection reusable',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-task4-hidden-column-'));
 const file=join(dir,'registry.sqlite');
 try{
  const fixture=new DatabaseSync(file);
  try{
   fixture.exec(`CREATE TABLE schema_version(version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES(1);
    CREATE TABLE scripts(
      id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,
      sha256 TEXT NOT NULL,health_status TEXT NOT NULL,metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      shadow TEXT GENERATED ALWAYS AS (display_name) VIRTUAL
    );`);
   fixture.prepare('INSERT INTO scripts(id,path,display_name,sha256,health_status,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('historic','/historic.user.js','important','hash','parsed','{}','date','date');
  }finally{fixture.close();}
  const db=openDatabase(file);
  try{
   assert.throws(()=>migrateDatabase(db),/schema|column|incompatible|hidden/i);
   assert.equal(db.prepare('SELECT display_name FROM scripts WHERE id=?').get('historic')?.display_name,'important');
   assert.equal(db.prepare('SELECT version FROM schema_version').get()?.version,1);
   assert.equal(db.prepare('PRAGMA table_xinfo(scripts)').all().length,9);
   db.exec('BEGIN IMMEDIATE');
   db.exec('ROLLBACK');
  }finally{db.close();}
  const verify=new DatabaseSync(file,{readOnly:true});
  try{assert.equal(verify.prepare('SELECT display_name FROM scripts WHERE id=?').get('historic')?.display_name,'important');}
  finally{verify.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
