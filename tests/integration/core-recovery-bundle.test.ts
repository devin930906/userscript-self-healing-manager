import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function loadBundle(){
 const api=await import('../../packages/repair-workflow/src/core-recovery.ts').catch(()=>({})) as {
  createCoreRecoveryBundle?:(input:{dataRoot:string;destination:string;registry:DatabaseSync;journal:ReturnType<typeof openDiagnosisJournal>})=>Promise<{path:string;manifestSha256:string}>;
  verifyCoreRecoveryBundle?:(input:{snapshotDirectory:string})=>Promise<{files:number;valid:true}>;
 };
 assert.equal(typeof api.createCoreRecoveryBundle,'function','coordinated core snapshot writer must exist');
 assert.equal(typeof api.verifyCoreRecoveryBundle,'function','independent read-only core snapshot verifier must exist');
 return api;
}
test('core recovery bundle preserves two committed SQLite WAL snapshots and hashed managed archives',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'usshm-core-snapshot-'));
 try{
  const dataRoot=join(tmp,'Data'),destination=join(tmp,'Core-Backup');
  await mkdir(dataRoot);
  const db=openDatabase(join(dataRoot,'registry.sqlite'));migrateDatabase(db);
  const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
  try{
   createScriptRepository(db).upsert({id:'one',path:'/scripts/one.user.js',displayName:'One',sha256:'a'.repeat(64),healthStatus:'parsed',metadataJson:'{}',createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z'});
   const scriptId='one';
   const folder=join(dataRoot,'managed',scriptId);
   await mkdir(folder,{recursive:true});
   const bytes=Buffer.from('// ==UserScript==\n// @name One\n// ==/UserScript==\n');
   const digest=sha(bytes);
   await writeFile(join(folder,'original-'+digest+'.user.js'),bytes);
   await writeFile(join(folder,'current.user.js'),bytes);
   const api=await loadBundle();
   const receipt=await api.createCoreRecoveryBundle!({dataRoot,destination,registry:db,journal});
   assert.equal(receipt.path,destination);
   assert.match(receipt.manifestSha256,/^[a-f0-9]{64}$/);
   const manifestBytes=await readFile(join(destination,'manifest.json'));
   assert.equal(sha(manifestBytes),receipt.manifestSha256);
   const manifest=JSON.parse(manifestBytes.toString('utf8'));
   assert.equal(manifest.kind,'usshm-core-recovery-v1');
   assert.equal(manifest.complete,true);
   assert.equal(manifest.atomicAcrossStores,false);
   assert.equal(manifest.files.length,3);
   const expected=['registry.sqlite','diagnosis-journal.sqlite','managed-recovery/manifest.json'];
   assert.deepEqual(manifest.files.map((x:{path:string})=>x.path),expected);
   const restored=new DatabaseSync(join(destination,'registry.sqlite'),{readOnly:true});
   try{
    assert.equal(restored.prepare('SELECT id FROM scripts').get()?.id,'one');
    assert.equal(restored.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
   }finally{restored.close();}
   assert.deepEqual(await api.verifyCoreRecoveryBundle!({snapshotDirectory:destination}),{files:3,valid:true});
   await assert.rejects(api.createCoreRecoveryBundle!({dataRoot,destination,registry:db,journal}),/exist|overwrite|refus/i);
  }finally{journal.close();db.close();}
 }finally{await rm(tmp,{recursive:true,force:true});}
});
test('core bundle integrity verification detects changed SQLite data without restoring or overwriting',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'usshm-core-corrupt-'));
 try{
  const dataRoot=join(tmp,'Data'),destination=join(tmp,'Backup');
  await mkdir(dataRoot);
  const db=openDatabase(join(dataRoot,'registry.sqlite'));migrateDatabase(db);
  const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
  try{
   const api=await loadBundle();
   await api.createCoreRecoveryBundle!({dataRoot,destination,registry:db,journal});
   await writeFile(join(destination,'registry.sqlite'),'invalid replacement');
   await assert.rejects(api.verifyCoreRecoveryBundle!({snapshotDirectory:destination}),/hash|mismatch|integrity|size/i);
   assert.equal(db.prepare('SELECT version FROM schema_version').get()?.version,1);
  }finally{journal.close();db.close();}
 }finally{await rm(tmp,{recursive:true,force:true});}
});
