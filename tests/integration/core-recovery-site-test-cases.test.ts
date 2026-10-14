import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createSiteTestCase} from '../../packages/candidate-engine/src/site-test-cases.ts';
import {createCoreRecoveryBundle,verifyCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';
import {stageCoreRecoveryForOfflineReview,verifyCoreOfflineRecoveryStage} from '../../packages/repair-workflow/src/core-recovery-stage.ts';

const metadata={match:['https://example.invalid/app/*'],include:[],exclude:[],raw:{
 match:['https://example.invalid/app/*'],
}};
async function scenario(check:(context:{dataRoot:string;backup:string;root:string})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-fr014-core-recovery-'));
 try{
  const dataRoot=join(root,'Data'),backup=join(root,'Core-Backup');
  await mkdir(dataRoot);
  const registry=openDatabase(join(dataRoot,'registry.sqlite'));
  migrateDatabase(registry);
  const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
  try{
   await createSiteTestCase({dataRoot,scriptId:'script-one',url:'https://example.invalid/app/dashboard',
    label:'Dashboard signed-out',stateId:'logged-out',metadata});
   await createSiteTestCase({dataRoot,scriptId:'script-one',url:'https://example.invalid/app/editor',
    label:'Editor signed-in',stateId:'logged-in',metadata});
   await createCoreRecoveryBundle({dataRoot,destination:backup,registry,journal});
  }finally{journal.close();registry.close();}
  await check({dataRoot,backup,root});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('RG-06 FR-014 core backup includes bounded test cases in a v2 hashed closed inventory',async()=>scenario(async({dataRoot,backup})=>{
 const report=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'));
 assert.equal(report.kind,'usshm-core-recovery-v2');
 assert.equal(report.scope,'registry+journal+managed-revisions+site-test-cases-only');
 assert.deepEqual(report.files.map((f:{path:string})=>f.path),[
  'registry.sqlite','diagnosis-journal.sqlite','managed-recovery/manifest.json','site-test-cases.json',
 ]);
 assert.equal(report.files.length,4);
 assert.deepEqual((await readdir(backup)).sort(),[
  'registry.sqlite','diagnosis-journal.sqlite','managed-recovery','site-test-cases.json','manifest.json',
 ].sort());
 assert.deepEqual(await readFile(join(dataRoot,'site-test-cases.json')),
  await readFile(join(backup,'site-test-cases.json')));
 assert.deepEqual(await verifyCoreRecoveryBundle({snapshotDirectory:backup}),{files:4,valid:true});
}));
test('RG-06 FR-014 stage copies v2 test cases into a non-active audited Data tree',async()=>scenario(async({dataRoot,backup,root})=>{
 const destination=join(root,'nonactive-Data');
 const staged=await stageCoreRecoveryForOfflineReview({
  snapshotDirectory:backup,activeDataRoot:dataRoot,destination,
 });
 assert.equal(staged.fileCount,3);
 assert.deepEqual(await readFile(join(destination,'site-test-cases.json')),
  await readFile(join(backup,'site-test-cases.json')));
 assert.deepEqual(await readFile(join(dataRoot,'site-test-cases.json')),
  await readFile(join(destination,'site-test-cases.json')));
 const marker=JSON.parse(await readFile(join(destination,'USSHM-RECOVERY-NOT-ACTIVE.json'),'utf8'));
 assert.equal(marker.activated,false);
 assert.equal(marker.scope,'registry+journal+managed-revisions+site-test-cases-only');
 const proof=await verifyCoreOfflineRecoveryStage({snapshotDirectory:backup,stagedDirectory:destination});
 assert.equal(proof.valid,true);assert.equal(proof.fileCount,3);
}));
test('RG-06 FR-014 corrupted or replaced scene files block backup verification and any staging writes',async()=>scenario(async({dataRoot,backup,root})=>{
 const original=await readFile(join(dataRoot,'site-test-cases.json'));
 await writeFile(join(backup,'site-test-cases.json'),'{BAD');
 await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:backup}),/hash|mismatch|test case|snapshot/i);
 const destination=join(root,'must-not-exist');
 await assert.rejects(stageCoreRecoveryForOfflineReview({
  snapshotDirectory:backup,activeDataRoot:dataRoot,destination,
 }),/hash|mismatch|test case|snapshot/i);
 await assert.rejects(access(destination),{code:'ENOENT'});
 assert.deepEqual(await readFile(join(dataRoot,'site-test-cases.json')),original,
  'failed audit must not touch the active configured page tests');
}));
test('RG-06 FR-014 v1 core bundles without test cases remain verifiable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-fr014-core-v1-'));
 try{
  const dataRoot=join(root,'Data'),backup=join(root,'Backup');await mkdir(dataRoot);
  const db=openDatabase(join(dataRoot,'registry.sqlite'));migrateDatabase(db);
  const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
  try{
   await createCoreRecoveryBundle({dataRoot,destination:backup,registry:db,journal});
   const manifest=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'));
   assert.equal(manifest.kind,'usshm-core-recovery-v1');
   assert.deepEqual(await verifyCoreRecoveryBundle({snapshotDirectory:backup}),{files:3,valid:true});
  }finally{journal.close();db.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('RG-06 newly created scenario during backup cannot be silently excluded by a v1 final manifest',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-fr014-late-scene-'));
 try{
  const dataRoot=join(root,'Data'),destination=join(root,'Core-Backup');
  await mkdir(dataRoot);
  const registry=openDatabase(join(dataRoot,'registry.sqlite'));migrateDatabase(registry);
  const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
  try{
   await assert.rejects(createCoreRecoveryBundle({
    dataRoot,destination,registry,journal,beforeFinalManifest:async()=>{
     await createSiteTestCase({dataRoot,scriptId:'script-one',
      url:'https://example.invalid/app/appeared-late',
      label:'Appeared during snapshot',stateId:'custom',metadata});
    },
   }),/scenario|scene|test case|changed|appeared/i);
   await assert.rejects(access(join(destination,'manifest.json')),{code:'ENOENT'});
   await access(join(dataRoot,'site-test-cases.json'));
  }finally{journal.close();registry.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('RG-06 refuses a corrupt live scene registry before publishing any complete marker',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-fr014-corrupt-scene-'));
 try{
  const dataRoot=join(root,'Data'),destination=join(root,'Core-Backup');
  await mkdir(dataRoot);
  await writeFile(join(dataRoot,'site-test-cases.json'),'{invalid scene JSON');
  const registry=openDatabase(join(dataRoot,'registry.sqlite'));migrateDatabase(registry);
  const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
  try{
   await assert.rejects(createCoreRecoveryBundle({dataRoot,destination,registry,journal}),/corrupt|invalid|test case/i);
   await assert.rejects(access(join(destination,'manifest.json')),{code:'ENOENT'});
   assert.equal(await readFile(join(dataRoot,'site-test-cases.json'),'utf8'),'{invalid scene JSON');
  }finally{journal.close();registry.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});
