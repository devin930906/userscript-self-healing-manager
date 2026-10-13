import assert from 'node:assert/strict';
import {test} from 'node:test';
import {access,mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal,type DiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';

test('RG-06 a complete recovery bundle must not trust a mismatched SQLite backup receipt',async()=>{
 for(const field of ['sha256','bytes'] as const){
  const scratch=await mkdtemp(join(tmpdir(),'usshm-rg06-receipt-'));
  try{
   const dataRoot=join(scratch,'active-Data'),destination=join(scratch,'Recovery');
   await mkdir(dataRoot);
   const registry=openDatabase(join(dataRoot,'registry.sqlite'));
   migrateDatabase(registry);
   const sourceJournal=join(dataRoot,'diagnosis-journal.sqlite');
   const realJournal=openDiagnosisJournal(sourceJournal);
   try{
    const forgedJournal={
     async backupSnapshot(path:string){
      // A genuine healthy SQLite snapshot, with fault injected into ONLY
      // the callback's claimed digest/size. No real user Data is involved.
      const honest=await realJournal.backupSnapshot(path);
      const actual=await readFile(path);
      assert.equal(createHash('sha256').update(actual).digest('hex'),honest.sha256);
      assert.equal(actual.byteLength,honest.bytes);
      return field==='sha256'?{...honest,sha256:'0'.repeat(64)}
       :{...honest,bytes:honest.bytes+1};
     },
    } as unknown as DiagnosisJournal;
    await assert.rejects(createCoreRecoveryBundle({
     dataRoot,destination,registry,journal:forgedJournal,
    }),/recovery|snapshot|hash|size|receipt|mismatch|integrity/i,
    'the actual SQLite bytes must be independently bound to the asserted backup receipt');
    await assert.rejects(access(join(destination,'manifest.json')),{code:'ENOENT'},
     'a forged receipt must never leave a complete:true recovery manifest');
    assert.equal(registry.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
   }finally{realJournal.close();registry.close();}
  }finally{await rm(scratch,{recursive:true,force:true});}
 }
});
