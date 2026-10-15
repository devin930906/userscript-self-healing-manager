import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,rm,access,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join,sep} from 'node:path';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle,verifyCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';
import {exportManagedRecovery,verifyManagedRecovery} from '../../packages/repair-workflow/src/managed-export.ts';
import {stageCoreRecoveryForOfflineReview,verifyCoreOfflineRecoveryStage} from '../../packages/repair-workflow/src/core-recovery-stage.ts';

async function fixture(run:(v:{root:string;data:string;backup:string;stage:string;
 registry:ReturnType<typeof openDatabase>;journal:ReturnType<typeof openDiagnosisJournal>})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-public-recovery-path-'));
 const data=join(root,'Data'),backup=join(root,'Backup'),stage=join(root,'Stage');
 await mkdir(data);
 const registry=openDatabase(join(data,'registry.sqlite'));migrateDatabase(registry);
 const journal=openDiagnosisJournal(join(data,'diagnosis-journal.sqlite'));
 try{
  await createCoreRecoveryBundle({dataRoot:data,destination:backup,registry,journal});
  await stageCoreRecoveryForOfflineReview({snapshotDirectory:backup,activeDataRoot:data,destination:stage});
  await run({root,data,backup,stage,registry,journal});
 }finally{journal.close();registry.close();await rm(root,{recursive:true,force:true});}
}
// Do not use join/resolve to construct hostile input: they erase the exact
// lexical component that the public entrypoint must preserve for its guard.
const disguised=(path:string)=>path+sep+'..'+sep+basename(path);
const unsafe=/unsafe|parent traversal|traversal|symlink|junction/i;

for(const field of ['dataRoot','destination'] as const){
 test('RG-06 core creation rejects raw '+field+' parent traversal before claiming output',async()=>fixture(async v=>{
  const output=join(v.root,'new-core');
  const args={dataRoot:v.data,destination:output,registry:v.registry,journal:v.journal};
  args[field]=disguised(args[field]);
  await assert.rejects(createCoreRecoveryBundle(args),unsafe);
  await assert.rejects(access(output),{code:'ENOENT'});
 }));
}
for(const field of ['managedRoot','destination'] as const){
 test('RG-06 managed export rejects raw '+field+' parent traversal before claiming output',async()=>fixture(async v=>{
  const output=join(v.root,'new-managed');
  const args={managedRoot:v.data,destination:output};args[field]=disguised(args[field]);
  await assert.rejects(exportManagedRecovery(args),unsafe);
  await assert.rejects(access(output),{code:'ENOENT'});
 }));
}
test('RG-06 core verification preserves the original snapshot path for its lexical guard',async()=>fixture(async v=>{
 await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:disguised(v.backup)}),unsafe);
}));
test('RG-06 managed verification preserves the original snapshot path for its lexical guard',async()=>fixture(async v=>{
 await assert.rejects(verifyManagedRecovery({snapshotDirectory:disguised(join(v.backup,'managed-recovery'))}),unsafe);
}));
for(const field of ['snapshotDirectory','activeDataRoot','destination'] as const){
 test('RG-06 offline stage creation rejects raw '+field+' traversal before claiming output',async()=>fixture(async v=>{
  const output=join(v.root,'new-stage');
  const args={snapshotDirectory:v.backup,activeDataRoot:v.data,destination:output};
  args[field]=disguised(args[field]);
  const before=await readFile(join(v.data,'registry.sqlite'));
  await assert.rejects(stageCoreRecoveryForOfflineReview(args),unsafe);
  await assert.rejects(access(output),{code:'ENOENT'});
  assert.deepEqual(await readFile(join(v.data,'registry.sqlite')),before);
 }));
}
for(const field of ['snapshotDirectory','stagedDirectory'] as const){
 test('RG-06 independent stage audit rejects raw '+field+' traversal',async()=>fixture(async v=>{
  const args={snapshotDirectory:v.backup,stagedDirectory:v.stage};args[field]=disguised(args[field]);
  const marker=join(v.stage,'USSHM-RECOVERY-NOT-ACTIVE.json'),before=await readFile(marker);
  await assert.rejects(verifyCoreOfflineRecoveryStage(args),unsafe);
  assert.deepEqual(await readFile(marker),before);
 }));
}
test('RG-06 public core verifier cannot erase a linked ancestor followed by parent traversal',async t=>fixture(async v=>{
 const external=join(v.root,'external'),nested=join(external,'nested');
 await mkdir(nested,{recursive:true});await mkdir(join(external,'Backup'));
 const alias=join(v.root,'linked');
 try{await symlink(nested,alias,process.platform==='win32'?'junction':'dir');}
 catch(error){
  if(['EPERM','EACCES','ENOTSUP','ENOSYS'].includes((error as NodeJS.ErrnoException).code??'')){
   t.skip('Runner cannot create synthetic directory symlink/junction');return;
  }
  throw error;
 }
 const raw=alias+sep+'..'+sep+'Backup';
 assert.equal(await realpath(raw),await realpath(join(external,'Backup')),
  'filesystem resolves the link before parent traversal, unlike lexical resolve');
 await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:raw}),unsafe,
  'a different normalized valid backup cannot stand in for the selected unsafe path');
}));
