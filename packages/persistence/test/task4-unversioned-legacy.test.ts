import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrateDatabase} from '../src/index.ts';

test('Task4 migration refuses unversioned nonempty SQLite with unrelated legacy table and preserves original bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-task4-unversioned-'));
 const file=join(dir,'registry.sqlite');
 try{
  const legacy=new DatabaseSync(file);
  try{
   legacy.exec("CREATE TABLE legacy_history(note TEXT NOT NULL); INSERT INTO legacy_history VALUES('preserve-history')");
  }finally{legacy.close();}
  const db=openDatabase(file);
  try{
   assert.throws(()=>migrateDatabase(db),/unversioned|unknown|schema|migration/i);
  }finally{db.close();}
  const after=new DatabaseSync(file,{readOnly:true});
  try{
   assert.equal(after.prepare("SELECT note FROM legacy_history").get()?.note,'preserve-history');
   assert.equal(after.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('schema_version','scripts')").get()?.count,0);
  }finally{after.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Task4 migration rejects sqliteXhistory user table despite LIKE underscore wildcard',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-task4-sqlitexhistory-'));
 const file=join(dir,'registry.sqlite');
 try{
  const legacy=new DatabaseSync(file);
  try{
   legacy.exec("CREATE TABLE sqliteXhistory(note TEXT NOT NULL); INSERT INTO sqliteXhistory VALUES('keep-sqlitexhistory')");
  }finally{legacy.close();}
  const db=openDatabase(file);
  try{assert.throws(()=>migrateDatabase(db),/unversioned|unknown|schema|migration/i);}
  finally{db.close();}
  const after=new DatabaseSync(file,{readOnly:true});
  try{
   assert.equal(after.prepare('SELECT note FROM sqliteXhistory').get()?.note,'keep-sqlitexhistory');
   assert.equal(after.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('schema_version','scripts')").get()?.count,0);
  }finally{after.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
