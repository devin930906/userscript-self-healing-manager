import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile,symlink,unlink,rmdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle,verifyCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';
import {stageCoreRecoveryForOfflineReview} from '../../packages/repair-workflow/src/core-recovery-stage.ts';

const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
async function fixture(check:(ctx:{source:string;backup:string;root:string;script:Buffer})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-stage-'));
 try{
  const source=join(root,'active-Data'),backup=join(root,'backup');
  await mkdir(source);
  const registry=openDatabase(join(source,'registry.sqlite'));
  migrateDatabase(registry);
  const journal=openDiagnosisJournal(join(source,'diagnosis-journal.sqlite'));
  const script=Buffer.from('// ==UserScript==\n// @name Recovery Test\n// ==/UserScript==\n');
  const managed=join(source,'managed','script-one');
  await mkdir(managed,{recursive:true});
  await writeFile(join(managed,'original-'+sha(script)+'.user.js'),script);
  await writeFile(join(managed,'current.user.js'),script);
  createScriptRepository(registry).upsert({
   id:'script-one',path:'/example/one.user.js',displayName:'One',sha256:'a'.repeat(64),
   healthStatus:'parsed',metadataJson:'{}',createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z'
  });
  try{await createCoreRecoveryBundle({dataRoot:source,destination:backup,registry,journal});}
  finally{journal.close();registry.close();}
  await check({source,backup,root,script});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('offline recovery stages verified registry, journal and managed bytes without installing into live Data',async()=>fixture(async({source,backup,root,script})=>{
 const destination=join(root,'staged-new-Data');
 const before=await readFile(join(source,'managed','script-one','current.user.js'));
 const receipt=await stageCoreRecoveryForOfflineReview({
  snapshotDirectory:backup,activeDataRoot:source,destination
 });
 assert.equal(receipt.path,destination);
 assert.equal(receipt.fileCount,4);
 const names=(await readdir(destination)).sort();
 assert.deepEqual(names,['USSHM-RECOVERY-NOT-ACTIVE.json','diagnosis-journal.sqlite','managed','registry.sqlite']);
 const db=new DatabaseSync(join(destination,'registry.sqlite'),{readOnly:true});
 try{
  assert.equal(db.prepare('SELECT id FROM scripts').get()?.id,'script-one');
  assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
 }finally{db.close();}
 assert.equal(sha(await readFile(join(destination,'managed','script-one','current.user.js'))),sha(script));
 assert.deepEqual(await readFile(join(source,'managed','script-one','current.user.js')),before);
 const warning=JSON.parse(await readFile(join(destination,'USSHM-RECOVERY-NOT-ACTIVE.json'),'utf8'));
 assert.equal(warning.kind,'usshm-core-offline-stage-v1');
 assert.equal(warning.activated,false);
 assert.equal(warning.includesBrowserProfiles,false);
 assert.equal(warning.includesSecrets,false);
 await assert.rejects(stageCoreRecoveryForOfflineReview({
  snapshotDirectory:backup,activeDataRoot:source,destination
 }),/exist|overwrite|claim/i);
}));
test('offline recovery refuses destinations within active Data or inside source snapshot',async()=>fixture(async({source,backup})=>{
 for(const destination of [join(source,'new-stage'),join(backup,'new-stage')]){
  await assert.rejects(stageCoreRecoveryForOfflineReview({
   snapshotDirectory:backup,activeDataRoot:source,destination
  }),/inside|source|Data|recovery/i);
 }
}));
test('offline recovery refuses a modified backup before creating its new output',async()=>fixture(async({source,backup,root})=>{
 await writeFile(join(backup,'registry.sqlite'),'corrupted');
 const destination=join(root,'should-not-exist');
 await assert.rejects(stageCoreRecoveryForOfflineReview({
  snapshotDirectory:backup,activeDataRoot:source,destination
 }),/hash|mismatch|integrity|size/i);
 await assert.rejects(readFile(join(destination,'registry.sqlite')),/ENOENT/);
}));

/**
 * Junctions/reparse points in an ANCESTOR are not visible when lstat() checks
 * only the final backup directory. All test paths are synthetic and temporary.
 */
test('QA-060 standalone core bundle verification refuses an ancestor directory symlink/junction',async t=>fixture(async({root,backup})=>{
 const alias=join(root,'alias-to-root');
 try{
  try{await symlink(root,alias,process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','EACCES','ENOTSUP','ENOSYS'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Runner cannot create a directory symlink/junction');return;
   }
   throw error;
  }
  const aliasedBackup=join(alias,'backup');
  assert.deepEqual(await readFile(join(aliasedBackup,'manifest.json')),
   await readFile(join(backup,'manifest.json')),'fixture must resolve to identical bytes');
  await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:aliasedBackup}),
   /symlink|junction|reparse|unsafe|linked/i,
   'valid snapshot bytes do not authorize traversing an unselected parent junction');
 }finally{
  try{await unlink(alias);}
  catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT'){
    if(['EPERM','EISDIR'].includes((error as NodeJS.ErrnoException).code??''))await rmdir(alias);
    else throw error;
   }
  }
 }
}));

test('QA-060 offline staging rejects symlink/junction ancestors in both snapshot and active Data',async t=>fixture(async({root,source,backup})=>{
 const alias=join(root,'alias-to-root');
 try{
  try{await symlink(root,alias,process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','EACCES','ENOTSUP','ENOSYS'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Runner cannot create a directory symlink/junction');return;
   }
   throw error;
  }
  const cases=[
   {snapshotDirectory:join(alias,'backup'),activeDataRoot:source,destination:join(root,'no-stage-from-aliased-backup')},
   {snapshotDirectory:backup,activeDataRoot:join(alias,'active-Data'),destination:join(root,'no-stage-from-aliased-data')},
  ];
  for(const input of cases){
   await assert.rejects(stageCoreRecoveryForOfflineReview(input),
    /symlink|junction|reparse|unsafe|linked/i,
    'untrusted parent alias must fail BEFORE claiming the recovery target');
   await assert.rejects(access(input.destination),{code:'ENOENT'});
  }
 }finally{
  try{await unlink(alias);}
  catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT'){
    if(['EPERM','EISDIR'].includes((error as NodeJS.ErrnoException).code??''))await rmdir(alias);
    else throw error;
   }
  }
 }
}));
