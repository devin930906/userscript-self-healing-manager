import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {cp,lstat,mkdtemp,mkdir,writeFile,readFile,readdir,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';
import {stageCoreRecoveryForOfflineReview,verifyCoreOfflineRecoveryStage} from '../../packages/repair-workflow/src/core-recovery-stage.ts';

const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
async function fixture(run:(v:{root:string;source:string;backup:string;stage:string;script:Buffer})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-stage-audit-'));
 try{
  const source=join(root,'Data'),backup=join(root,'Core-Backup'),stage=join(root,'Offline-Stage');
  await mkdir(source);
  const registry=openDatabase(join(source,'registry.sqlite'));
  migrateDatabase(registry);
  const journal=openDiagnosisJournal(join(source,'diagnosis-journal.sqlite'));
  const script=Buffer.from('// ==UserScript==\n// @name Synthetic Offline Audit\n// ==/UserScript==\n');
  const dir=join(source,'managed','fixture');
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'original-'+sha(script)+'.user.js'),script);
  await writeFile(join(dir,'current.user.js'),script);
  try{await createCoreRecoveryBundle({dataRoot:source,destination:backup,registry,journal});}
  finally{journal.close();registry.close();}
  await stageCoreRecoveryForOfflineReview({snapshotDirectory:backup,activeDataRoot:source,destination:stage});
  await run({root,source,backup,stage,script});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('RG-06 independent offline staging verifier accepts unchanged synthetic stage and leaves Data untouched',async()=>fixture(async({backup,stage,source,script})=>{
 const before=await readFile(join(source,'managed','fixture','current.user.js'));
 const audit=await verifyCoreOfflineRecoveryStage({snapshotDirectory:backup,stagedDirectory:stage});
 assert.deepEqual(audit,{valid:true,fileCount:4,sourceManifestSha256:sha(await readFile(join(backup,'manifest.json')))});
 assert.deepEqual(await readFile(join(source,'managed','fixture','current.user.js')),before);
 assert.deepEqual(before,script);
}));
for(const scenario of ['changed-file','unexpected-file','tampered-marker','wrong-origin','corrupt-sqlite'] as const){
 test('RG-06 independent offline stage audit fails closed after '+scenario,async()=>fixture(async({backup,stage,source})=>{
  const expected=await readFile(join(source,'managed','fixture','current.user.js'));
  const marker=join(stage,'USSHM-RECOVERY-NOT-ACTIVE.json');
  if(scenario==='changed-file'){
   const target=join(stage,'managed','fixture','current.user.js');
   const before=await readFile(target),changed=Buffer.from(before);
   changed[16]=changed[16]===65?66:65;
   await writeFile(target,changed);
  }else if(scenario==='unexpected-file'){
   await writeFile(join(stage,'extra-payload.user.js'),'SYNTHETIC_NOT_IN_MANIFEST');
  }else if(scenario==='corrupt-sqlite'){
   await writeFile(join(stage,'registry.sqlite'),'INVALID_STAGED_SQLITE');
  }else{
   const obj=JSON.parse(await readFile(marker,'utf8')) as Record<string,unknown>;
   if(scenario==='tampered-marker')obj.activated=true;
   else obj.sourceManifestSha256='0'.repeat(64);
   await writeFile(marker,JSON.stringify(obj)+'\n');
  }
  await assert.rejects(
   verifyCoreOfflineRecoveryStage({snapshotDirectory:backup,stagedDirectory:stage}),
   /offline|stage|source|manifest|marker|hash|changed|mismatch|sqlite|unexpected|unsafe|complete|recovery/i,
   'a completed but altered offline staging tree is not verified');
  assert.deepEqual(await readFile(join(source,'managed','fixture','current.user.js')),expected,
   'audit must not mutate active source Data');
  assert.deepEqual((await readdir(stage)).includes('USSHM-RECOVERY-NOT-ACTIVE.json'),true);
 }));
}


test('RG-06 independent stage audit rejects a late same-size mutation while finishing source revalidation',async()=>fixture(async({backup,stage,source,script})=>{
 const live=join(source,'managed','fixture','current.user.js');
 const original=await readFile(live);
 const staged=join(stage,'managed','fixture','current.user.js');
 let reached=0;
 const injected=Buffer.from(script);
 injected[17]=injected[17]===65?66:65;
 assert.equal(injected.byteLength,script.byteLength);
 await assert.rejects(verifyCoreOfflineRecoveryStage({
  snapshotDirectory:backup,stagedDirectory:stage,
  // Internal test-only checkpoint, never exposed to a renderer or recovery activation.
  beforeFinalStageAudit:async()=>{reached++;await writeFile(staged,injected);},
 }),/stage|hash|changed|identity|mismatch|recovery|unsafe/i,
 'a stage changed during late source verification cannot be certified valid');
 assert.equal(reached,1,'fault injection must happen before the last stage byte audit');
 assert.deepEqual(await readFile(live),original,'read-only audit must never modify active Data');
 assert.deepEqual(await readFile(staged),injected,'failed audit must not silently mutate the stage');
}));

test('RG-06 independent stage audit rejects a late unexpected file in its closed staged inventory',async()=>fixture(async({backup,stage,source})=>{
 const live=join(source,'registry.sqlite');
 const original=await readFile(live);
 let reached=0;
 await assert.rejects(verifyCoreOfflineRecoveryStage({
  snapshotDirectory:backup,stagedDirectory:stage,
  beforeFinalStageAudit:async()=>{reached++;await writeFile(join(stage,'unlisted-payload.user.js'),'SYNTHETIC_NOT_IN_MANIFEST');},
 }),/stage|unexpected|inventory|unsafe|recovery|file/i);
 assert.equal(reached,1);
 assert.deepEqual(await readFile(live),original,'live database must remain byte-identical');
}));


test('RG-06 independent stage audit rejects a completion marker atomically replaced with identical bytes',async()=>fixture(async({root,backup,stage,source})=>{
 const marker=join(stage,'USSHM-RECOVERY-NOT-ACTIVE.json');
 const original=await readFile(marker);
 const live=await readFile(join(source,'registry.sqlite'));
 let injections=0;
 await assert.rejects(verifyCoreOfflineRecoveryStage({
  snapshotDirectory:backup,stagedDirectory:stage,
  // Same contents, NEW inode. A file identity guard must reject this
  // substitution even though the final bytes and SHA-256 still match.
  beforeFinalStageAudit:async()=>{
   injections++;
   await rename(marker,join(root,'displaced-marker.json'));
   await writeFile(marker,original,{flag:'wx'});
  },
 }),/marker|identity|replaced|changed|unsafe|stage/i,
 'a marker is atomically replaced during verification and cannot be certified');
 assert.equal(injections,1);
 assert.deepEqual(await readFile(marker),original,'fault fixture really preserved byte-identical marker content');
 assert.deepEqual(await readFile(join(source,'registry.sqlite')),live,'audit cannot mutate active Data');
}));

test('RG-06 rejects a new staged directory inode even if every file and the ORIGINAL completion marker are unchanged',async()=>fixture(async({root,backup,stage,source})=>{
 const markerName='USSHM-RECOVERY-NOT-ACTIVE.json';
 const marker=join(stage,markerName);
 const markerBefore=await lstat(marker,{bigint:true});
 const dirBefore=await lstat(stage,{bigint:true});
 const dataBefore=await readFile(join(source,'registry.sqlite'));
 const markerBytes=await readFile(marker);
 let swapped=0;
 await assert.rejects(verifyCoreOfflineRecoveryStage({
  snapshotDirectory:backup,stagedDirectory:stage,
  beforeFinalStageAudit:async()=>{
   swapped++;
   // Complete byte-for-byte clone of every staged file. Unlike prior
   // marker-swap tests, keep the ORIGINAL marker inode in the new root.
   const displaced=join(root,'displaced-stage');
   await rename(stage,displaced);
   await cp(displaced,stage,{recursive:true});
   await rm(join(stage,markerName));
   await rename(join(displaced,markerName),marker);
   const sameMarker=await lstat(marker,{bigint:true});
   assert.equal(sameMarker.ino,markerBefore.ino,'original marker identity must survive');
   assert.equal(sameMarker.dev,markerBefore.dev);
   assert.deepEqual(await readFile(marker),markerBytes);
   const different=await lstat(stage,{bigint:true});
   assert.ok(different.ino!==dirBefore.ino||different.birthtimeNs!==dirBefore.birthtimeNs,
    'fault must replace the actual directory, not just its contents');
  },
 }),/stage|directory|identity|swapped|replaced|changed|unsafe/i,
 'a newly rebound staging directory cannot inherit the old audited identity');
 assert.equal(swapped,1);
 assert.deepEqual(await readFile(join(source,'registry.sqlite')),dataBefore,
  'independent audit must not modify live source Data');
 assert.deepEqual(await readFile(marker),markerBytes,
  'test must keep the original marker bytes, not trigger the existing marker test');
}));
