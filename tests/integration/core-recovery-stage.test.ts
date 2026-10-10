import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';
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
