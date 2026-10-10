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
 {name:'unrecognized trigger',sql:`CREATE TRIGGER malicious_insert AFTER INSERT ON scripts
  BEGIN DELETE FROM scripts WHERE id = NEW.id; END;`},
 {name:'unexpected scripts column',sql:'ALTER TABLE scripts ADD COLUMN unrecognized TEXT'}
]){
 test(`core recovery verifier rejects a checksum-rewritten registry containing an ${alteration.name}`,async()=>{
  const tmp=await mkdtemp(join(tmpdir(),'usshm-recovery-schema-'));
  try{
   const dataRoot=join(tmp,'Data'),destination=join(tmp,'Core-Backup');
   await mkdir(dataRoot);
   const registry=openDatabase(join(dataRoot,'registry.sqlite'));
   migrateDatabase(registry);
   const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
   try{
    await createCoreRecoveryBundle({dataRoot,destination,registry,journal});
    const snapshot=join(destination,'registry.sqlite');
    // Model an untrusted archive whose SQLite payload and ordinary SHA-256
    // manifest were both rewritten, while SQLite integrity_check still passes.
    const injected=new DatabaseSync(snapshot);
    try{injected.exec(alteration.sql);}finally{injected.close();}
    const modified=await readFile(snapshot);
    const manifestPath=join(destination,'manifest.json');
    const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as {
     files:Array<{path:string;sha256:string;bytes:number}>;
    };
    assert.equal(manifest.files[0]?.path,'registry.sqlite');
    manifest.files[0]!.sha256=sha256(modified);
    manifest.files[0]!.bytes=modified.length;
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    await assert.rejects(
     verifyCoreRecoveryBundle({snapshotDirectory:destination}),
     /schema|trigger|columns|incompatible|unsafe/i
    );
   }finally{journal.close();registry.close();}
  }finally{await rm(tmp,{recursive:true,force:true});}
 });
}
