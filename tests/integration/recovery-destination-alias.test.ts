import assert from 'node:assert/strict';
import {test} from 'node:test';
import {access,mkdir,mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';
import {exportManagedRecovery} from '../../packages/repair-workflow/src/managed-export.ts';

async function assertNotCreated(path:string):Promise<void>{
 await assert.rejects(access(path),{code:'ENOENT'});
}
async function assertRejectedRecoveryDestinations(dataRoot:string,parent:string):Promise<void>{
 const db=openDatabase(join(dataRoot,'registry.sqlite'));
 migrateDatabase(db);
 const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
 try{
  const managedDestination=join(parent,'managed-export');
  await assert.rejects(
   exportManagedRecovery({managedRoot:dataRoot,destination:managedDestination}),
   /inside|source|backup destination/i,
   'managed backup must reject an alias resolving into its own Data root'
  );
  await assertNotCreated(managedDestination);
  const coreDestination=join(parent,'core-export');
  await assert.rejects(
   createCoreRecoveryBundle({dataRoot,destination:coreDestination,registry:db,journal}),
   /inside|source|backup destination/i,
   'core backup must reject an alias resolving into its own Data root'
  );
  await assertNotCreated(coreDestination);
 }finally{journal.close();db.close();}
}

test('recovery destinations starting with two dots inside Data are not external backups',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-recovery-dot-prefix-'));
 try{
  const dataRoot=join(root,'Data');
  const deceptive=join(dataRoot,'..external-backups');
  await mkdir(deceptive,{recursive:true});
  await assertRejectedRecoveryDestinations(dataRoot,deceptive);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('recovery destinations reached through ancestor symlink/junction cannot point back into Data',async t=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-recovery-dir-alias-'));
 try{
  const dataRoot=join(root,'Data'),actual=join(dataRoot,'backups');
  const alias=join(root,'outside-alias');
  await mkdir(actual,{recursive:true});
  try{await symlink(dataRoot,alias,process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','ENOSYS','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Host does not permit directory symlinks or junctions');
    return;
   }
   throw error;
  }
  await assertRejectedRecoveryDestinations(dataRoot,join(alias,'backups'));
 }finally{await rm(root,{recursive:true,force:true});}
});
