import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrateDatabase} from '../src/index.ts';

test('Task4 versioned Registry rejects unrelated legacy table while retaining rows and transaction usability',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-task4-versioned-extra-table-'));
 const file=join(dir,'registry.sqlite');
 try{
  const fixture=openDatabase(file);
  try{
   migrateDatabase(fixture);
   fixture.exec("CREATE TABLE legacy_private_history(note TEXT NOT NULL); INSERT INTO legacy_private_history VALUES('preserve-private-history')");
  }finally{fixture.close();}
  const db=openDatabase(file);
  try{
   assert.throws(()=>migrateDatabase(db),/unknown|unexpected|schema|incompatible/i);
   assert.equal(db.prepare('SELECT note FROM legacy_private_history').get()?.note,'preserve-private-history');
   assert.equal(db.prepare('SELECT version FROM schema_version').get()?.version,1);
   db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');
  }finally{db.close();}
  const after=new DatabaseSync(file,{readOnly:true});
  try{
   assert.equal(after.prepare('SELECT note FROM legacy_private_history').get()?.note,'preserve-private-history');
  }finally{after.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
