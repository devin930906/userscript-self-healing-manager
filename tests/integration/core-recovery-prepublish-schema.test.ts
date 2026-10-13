import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {createCoreRecoveryBundle,verifyCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';
import type {DiagnosisJournal} from '../../packages/job-journal/src/index.ts';

test('RG-06 refuses to publish a complete recovery manifest for a checksummed but invalid journal SQLite snapshot',async()=>{
 for(const malformed of ['wrong-version','missing-journal-schema'] as const){
  const root=await mkdtemp(join(tmpdir(),'usshm-core-prefinal-schema-'));
  try{
   const dataRoot=join(root,'Data'),destination=join(root,'Backup');
   await mkdir(dataRoot);
   const registry=openDatabase(join(dataRoot,'registry.sqlite'));
   migrateDatabase(registry);
   try{
    // Fault-injected, local test-only journal backup. Its bytes and digest
    // match perfectly, but the SQLite snapshot is NOT a valid journal.
    const journal={
     async backupSnapshot(path:string){
      const fake=new DatabaseSync(path);
      try{
       fake.exec('CREATE TABLE synthetic_only(id INTEGER PRIMARY KEY)');
       if(malformed==='missing-journal-schema')fake.exec('PRAGMA user_version=1');
      }finally{fake.close();}
      const bytes=await readFile(path);
      return {sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
     },
    } as unknown as DiagnosisJournal;
    await assert.rejects(
     createCoreRecoveryBundle({dataRoot,destination,registry,journal}),
     /journal|schema|version|integrity|recovery/i,
     'backup creation must independently validate SQLite before publishing complete:true',
    );
    await assert.rejects(access(join(destination,'manifest.json')),{code:'ENOENT'},
     'an incompatible SQLite backup must leave NO complete manifest for a later user to trust');
    await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:destination}),
     /recovery|manifest|content|invalid|incomplete/i);
    assert.equal(registry.prepare('SELECT version FROM schema_version').get()?.version,1,
     'the active registry must not be modified by the failed recovery export');
   }finally{registry.close();}
  }finally{await rm(root,{recursive:true,force:true});}
 }
});
