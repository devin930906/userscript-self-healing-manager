import assert from 'node:assert/strict';
import {link,lstat,mkdir,mkdtemp,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {createCoreRecoveryBundle,verifyCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';

async function bundle(run:(input:{root:string;backup:string})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-core-recovery-alias-'));
 try{
  const data=join(root,'Data'),backup=join(root,'Core-Backup');
  await mkdir(data);
  const registry=openDatabase(join(data,'registry.sqlite'));
  migrateDatabase(registry);
  const journal=openDiagnosisJournal(join(data,'diagnosis-journal.sqlite'));
  try{
   await createCoreRecoveryBundle({dataRoot:data,destination:backup,registry,journal});
   assert.deepEqual(await verifyCoreRecoveryBundle({snapshotDirectory:backup}),{files:3,valid:true});
   await run({root,backup});
  }finally{journal.close();registry.close();}
 }finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06 core manifest hardlink cannot pass read-only recovery certification',async()=>bundle(async({root,backup})=>{
 const manifest=join(backup,'manifest.json'),alias=join(root,'core-manifest-alias.json');
 await link(manifest,alias);
 assert.equal((await lstat(manifest)).nlink,2);
 await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:backup}),
  /hard.?link|alias|unsafe|snapshot|recovery/i,
  'matching manifest bytes do not prove the backup is isolated from external writes');
 await unlink(alias);
 assert.deepEqual(await verifyCoreRecoveryBundle({snapshotDirectory:backup}),{files:3,valid:true});
}));

test('RG-06 core SQLite snapshots may not be hardlinked to external mutable paths',async()=>bundle(async({root,backup})=>{
 for(const [index,file] of ['registry.sqlite','diagnosis-journal.sqlite'].entries()){
  const snapshot=join(backup,file),alias=join(root,'synthetic-database-alias-'+index+'.sqlite');
  await link(snapshot,alias);
  assert.equal((await lstat(snapshot)).nlink,2);
  await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:backup}),
   /hard.?link|alias|unsafe|snapshot|recovery/i,
   'a hash-matching but alias-writable SQLite backup is not immutable');
  await unlink(alias);
  assert.deepEqual(await verifyCoreRecoveryBundle({snapshotDirectory:backup}),{files:3,valid:true});
 }
}));
