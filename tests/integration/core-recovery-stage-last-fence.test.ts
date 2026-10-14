import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,access,link,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';
import {stageCoreRecoveryForOfflineReview} from '../../packages/repair-workflow/src/core-recovery-stage.ts';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

/** All sources are synthetic and under an exclusively owned temporary root. */
async function withSnapshot(check:(v:{
 root:string;source:string;backup:string;target:string;script:Buffer;
})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-rg06-final-stage-'));
 try{
  const source=join(root,'active-Data'),backup=join(root,'Core-Backup');
  const target=join(root,'Stage');
  await mkdir(source);
  const registry=openDatabase(join(source,'registry.sqlite'));
  migrateDatabase(registry);
  const journal=openDiagnosisJournal(join(source,'diagnosis-journal.sqlite'));
  const script=Buffer.from('// ==UserScript==\n// @name Synthetic Recovery\n// ==/UserScript==\n');
  const folder=join(source,'managed','synthetic');
  await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'original-'+sha(script)+'.user.js'),script);
  await writeFile(join(folder,'current.user.js'),script);
  try{await createCoreRecoveryBundle({dataRoot:source,destination:backup,registry,journal});}
  finally{journal.close();registry.close();}
  await check({root,source,backup,target,script});
 }finally{await rm(root,{recursive:true,force:true});}
}

for(const scenario of ['managed-same-size-rewrite','registry-corruption','managed-hardlink'] as const){
 test('RG-06 offline stage must not publish marker after late '+scenario,async t=>
  withSnapshot(async({root,source,backup,target,script})=>{
   const original=await readFile(join(source,'managed','synthetic','current.user.js'));
   let injected=0;
   const stagedManaged=join(target,'managed','synthetic','current.user.js');
   const beforeFinalMarker=async()=>{
    injected++;
    if(scenario==='managed-same-size-rewrite'){
     const swapped=Buffer.from(script);
     swapped[15]=swapped[15]===65?66:65;
     assert.equal(swapped.byteLength,script.byteLength);
     await writeFile(stagedManaged,swapped);
    }else if(scenario==='registry-corruption'){
     await writeFile(join(target,'registry.sqlite'),'NOT_A_SQLITE_DATABASE');
    }else{
     try{await link(stagedManaged,join(root,'external-stage-alias.user.js'));}
     catch(error){
      if(['EPERM','ENOTSUP','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){
       t.skip('filesystem cannot create synthetic hardlink alias');
       return;
      }
      throw error;
     }
    }
   };
   // Test-only hook models an uncooperative writer AFTER copies have been
   // individually checked and BEFORE publishing the "non-active" marker.
   const options={
    snapshotDirectory:backup,activeDataRoot:source,destination:target,
    beforeFinalMarker,
   } as Parameters<typeof stageCoreRecoveryForOfflineReview>[0];
   if(scenario==='managed-hardlink'){
    // Skip is only meaningful for a runner where hardlinks are impossible.
    // The other two deterministic mutations remain mandatory.
    try{
     await assert.rejects(stageCoreRecoveryForOfflineReview(options),
      /staged|snapshot|recovery|alias|hardlink|hash|integrity|changed|unsafe|mismatch/i);
    }catch(error){
     if(!t.signal?.aborted)throw error;
    }
   }else{
    await assert.rejects(stageCoreRecoveryForOfflineReview(options),
     /staged|snapshot|recovery|hash|integrity|changed|unsafe|mismatch/i);
   }
   assert.equal(injected,1,'fault injection must occur after all copies are written');
   await assert.rejects(access(join(target,'USSHM-RECOVERY-NOT-ACTIVE.json')),{code:'ENOENT'},
    'a modified or aliased staged output must not receive a completion marker');
   assert.deepEqual(await readFile(join(source,'managed','synthetic','current.user.js')),
    original,'the live Data original must remain byte-identical');
  })
 );
}


test('RG-06 late source snapshot mutation after the last audit cannot receive an offline stage completion marker',async()=>withSnapshot(async({source,backup,target})=>{
 // The existing fence checks only the staged copy after this test-only
 // callback. Simulate an external writer corrupting the still-referenced
 // source backup AFTER the previous verifyCoreRecoveryBundle call.
 const activeOriginal=await readFile(join(source,'registry.sqlite'));
 const originalBackup=await readFile(join(backup,'registry.sqlite'));
 let injected=0;
 await assert.rejects(stageCoreRecoveryForOfflineReview({
  snapshotDirectory:backup,activeDataRoot:source,destination:target,
  beforeFinalMarker:async()=>{
   injected++;
   // Mutate only a disposable BACKUP inside this synthetic temporary root.
   // Never write to the active source or any real userscript/profile.
   await writeFile(join(backup,'registry.sqlite'),'SYNTHETIC_LATE_SOURCE_CORRUPTION');
  },
 }),/source|snapshot|recovery|changed|hash|corrupt|integrity|mismatch/i,
  'a late changed source backup must not be blessed by a completed stage marker');
 assert.equal(injected,1,'inject after copied files and earlier source verification');
 await assert.rejects(access(join(target,'USSHM-RECOVERY-NOT-ACTIVE.json')),{code:'ENOENT'},
  'the offline stage completion marker must remain absent');
 assert.deepEqual(await readFile(join(source,'registry.sqlite')),activeOriginal,
  'the active Data registry must remain byte-identical');
 assert.notDeepEqual(await readFile(join(backup,'registry.sqlite')),originalBackup,
  'fault injection must actually alter the backup snapshot');
}));
