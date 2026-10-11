import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle,verifyCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';

const sha256=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');

for(const alteration of [
 {name:'unexpected mutating trigger',sql:`CREATE TRIGGER erase_on_insert AFTER INSERT ON journal_runs
  BEGIN DELETE FROM journal_items; END;`},
 {name:'unexpected journal column',sql:'ALTER TABLE journal_runs ADD COLUMN unauthorized_data TEXT'},
 {name:'dropped journal foreign key',sql:`PRAGMA foreign_keys=OFF;
  ALTER TABLE journal_items RENAME TO old_items;
  CREATE TABLE journal_items(
   run_id TEXT NOT NULL,item_index INTEGER NOT NULL,status TEXT NOT NULL,
   checked INTEGER NOT NULL,found INTEGER NOT NULL,missing INTEGER NOT NULL,
   needs_review INTEGER NOT NULL,verification_v0 TEXT NOT NULL,
   verification_v1 TEXT NOT NULL,PRIMARY KEY(run_id,item_index));
  DROP TABLE old_items;`}
]){
 test(`core recovery refuses manifest-resigned journal with ${alteration.name}`,async()=>{
  const tmp=await mkdtemp(join(tmpdir(),'usshm-journal-schema-'));
  try{
   const dataRoot=join(tmp,'Data'),destination=join(tmp,'Core-Backup');
   await mkdir(dataRoot);
   const registry=openDatabase(join(dataRoot,'registry.sqlite'));
   migrateDatabase(registry);
   const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
   try{
    await createCoreRecoveryBundle({dataRoot,destination,registry,journal});
    const snapshot=join(destination,'diagnosis-journal.sqlite');
    const injected=new DatabaseSync(snapshot);
    try{injected.exec(alteration.sql);}finally{injected.close();}
    const bytes=await readFile(snapshot);
    const manifestPath=join(destination,'manifest.json');
    const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as {
     files:Array<{path:string;sha256:string;bytes:number}>;
    };
    assert.equal(manifest.files[1]?.path,'diagnosis-journal.sqlite');
    manifest.files[1]!.sha256=sha256(bytes);
    manifest.files[1]!.bytes=bytes.length;
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:destination}),
     /schema|journal|trigger|foreign|incompatible|unsafe/i);
   }finally{journal.close();registry.close();}
  }finally{await rm(tmp,{recursive:true,force:true});}
 });
}
