import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {exportManagedRecovery,verifyManagedRecovery} from '../../packages/repair-workflow/src/managed-export.ts';
import {createCoreRecoveryBundle,verifyCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';
import {stageCoreRecoveryForOfflineReview} from '../../packages/repair-workflow/src/core-recovery-stage.ts';

async function withFreshDataRoot(run:(root:string,dataRoot:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-empty-managed-recovery-'));
 try{
  const dataRoot=join(root,'Data');
  await mkdir(join(dataRoot,'managed'),{recursive:true});
  await run(root,dataRoot);
 }finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06 an existing empty managed directory yields a complete zero-script manifest with independent verification',async()=>withFreshDataRoot(async(root,dataRoot)=>{
 const backup=join(root,'managed-snapshot');
 const receipt=await exportManagedRecovery({managedRoot:dataRoot,destination:backup});
 assert.deepEqual(receipt.files,[]);
 const manifest=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'));
 assert.equal(manifest.complete,true);
 assert.deepEqual(manifest.files,[]);
 assert.deepEqual(await readdir(backup),['manifest.json'],'do not publish an unlisted empty managed directory');
 assert.deepEqual(await verifyManagedRecovery({snapshotDirectory:backup}),{files:0,bytes:0});
 assert.deepEqual(await readdir(join(dataRoot,'managed')),[],'original empty Data folder remains untouched');
}));

test('RG-06 fresh installed Data with empty managed directory can backup, audit and stage both SQLite stores offline',async()=>withFreshDataRoot(async(root,dataRoot)=>{
 const registry=openDatabase(join(dataRoot,'registry.sqlite'));
 migrateDatabase(registry);
 const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
 const backup=join(root,'core-snapshot');
 try{
  await createCoreRecoveryBundle({dataRoot,destination:backup,registry,journal});
 }finally{journal.close();registry.close();}
 assert.deepEqual(await verifyCoreRecoveryBundle({snapshotDirectory:backup}),{files:3,valid:true});
 const staged=join(root,'offline-stage');
 const receipt=await stageCoreRecoveryForOfflineReview({
  snapshotDirectory:backup,activeDataRoot:dataRoot,destination:staged,
 });
 assert.equal(receipt.path,staged);
 assert.equal(receipt.fileCount,2,'only registry and journal, no managed userscripts');
 const warning=JSON.parse(await readFile(join(staged,'USSHM-RECOVERY-NOT-ACTIVE.json'),'utf8'));
 assert.equal(warning.activated,false);
 assert.equal(warning.includesOriginalUserscripts,false);
 assert.deepEqual((await readdir(staged)).sort(),[
  'USSHM-RECOVERY-NOT-ACTIVE.json','diagnosis-journal.sqlite','registry.sqlite'
 ].sort());
 assert.deepEqual(await readdir(join(dataRoot,'managed')),[],'active Data remains unchanged');
}));
