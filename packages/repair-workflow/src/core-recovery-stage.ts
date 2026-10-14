import {createHash} from 'node:crypto';
import {constants,createReadStream} from 'node:fs';
import {copyFile,lstat,mkdir,readdir,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {DatabaseSync} from 'node:sqlite';
import {assertRecoveryDestinationOutsideSource} from '../../runtime-paths/src/recovery-destination.ts';
import {assertRegistryV1SnapshotSchema} from '../../persistence/src/index.ts';
import {assertJournalSchemaSafety} from '../../job-journal/src/index.ts';
import {assertUnlinkedRecoveryDirectory} from '../../runtime-paths/src/recovery-directory.ts';
import {verifyCoreRecoveryBundle} from './core-recovery.ts';

const hex=/^[a-f0-9]{64}$/;
const managedPath=/^managed\/[A-Za-z0-9_-]{1,64}\/(?:current\.user\.js|(?:original|revision)-[a-f0-9]{64}\.user\.js)$/;
type HashedFile={path:string;sha256:string;bytes:number};
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');

/**
 * Revalidate the actual staged pathname and bounded bytes, not merely the
 * initial copy. The stage is a NON-ACTIVE recovery review output, but a
 * completed marker must never bless a later swap, hardlink or same-size edit.
 */
async function assertStagedCopy(path:string,expected:HashedFile):Promise<void>{
 await assertUnlinkedRecoveryDirectory(dirname(path));
 const before=await lstat(path,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||
    before.size!==BigInt(expected.bytes))
  throw new Error('Unsafe staged offline recovery file type, alias or size');
 const hash=createHash('sha256');
 let copied=0;
 for await(const part of createReadStream(path)){
  copied+=(part as Buffer).byteLength;
  if(copied>expected.bytes)throw new Error('Staged recovery exceeded byte budget');
  hash.update(part);
 }
 const after=await lstat(path,{bigint:true});
 if(!after.isFile()||after.isSymbolicLink()||after.nlink!==1n||
    before.dev!==after.dev||before.ino!==after.ino||
    before.size!==after.size||before.birthtimeNs!==after.birthtimeNs||
    before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||
    before.mode!==after.mode)
  throw new Error('Staged offline recovery file changed during verification');
 if(copied!==expected.bytes||hash.digest('hex')!==expected.sha256)
  throw new Error('Staged offline recovery file hash mismatch');
}

async function readBoundedManifest(path:string):Promise<Buffer>{
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024)
  throw new Error('Unsafe offline recovery manifest');
 return readPinnedRegularFile(path,{maxBytes:1024*1024,expected:info,expectedNative:await lstat(path,{bigint:true})});
}
async function copyChecked(source:string,destination:string,expected:HashedFile){
 const before=await lstat(source);
 if(!before.isFile()||before.isSymbolicLink()||before.size!==expected.bytes||
    expected.bytes>512*1024*1024||expected.bytes<0)
  throw new Error('Unsafe or changed source recovery file');
 // Destination must not exist; the caller claimed an exclusively new root.
 await copyFile(source,destination,constants.COPYFILE_EXCL);
 const after=await lstat(destination);
 if(!after.isFile()||after.isSymbolicLink()||after.size!==expected.bytes)
  throw new Error('Offline recovery copied file has wrong type or size');
 await assertStagedCopy(destination,expected);
}
/**
 * Recover ONLY the pre-audited core Data subset into an exclusively new,
 * NON-ACTIVE directory for offline review. No mutation of the running Data,
 * original userscripts, Chrome profiles, manager storage or existing backup.
 *
 * This is a controlled staging copy, never a live restore. The marker is
 * written last. Incomplete directories are deliberately left for inspection
 * rather than automatically deleted after an IO error.
 */
export async function stageCoreRecoveryForOfflineReview({
 snapshotDirectory,activeDataRoot,destination,beforeFinalMarker,
}:{
 readonly snapshotDirectory:string;readonly activeDataRoot:string;readonly destination:string;
 /** Internal deterministic fault-injection hook, never wired from renderer. */
 readonly beforeFinalMarker?:()=>Promise<void>;
}):Promise<{path:string;fileCount:number;sourceManifestSha256:string}>{
 if([snapshotDirectory,activeDataRoot,destination].some(p=>
   typeof p!=='string'||!isAbsolute(p)))
  throw new Error('Absolute offline recovery paths required');
 const source=resolve(snapshotDirectory),active=resolve(activeDataRoot),target=resolve(destination);
 await assertUnlinkedRecoveryDirectory(source);
 await assertUnlinkedRecoveryDirectory(active);
 await assertUnlinkedRecoveryDirectory(dirname(target));
 // Protect both source snapshot and currently running Data from accidental
 // nesting, symlink/junction aliases, and recursive self-copy.
 await assertRecoveryDestinationOutsideSource(source,target);
 await assertRecoveryDestinationOutsideSource(active,target);
 // Full integrity and schema validation happens BEFORE any destination write.
 await verifyCoreRecoveryBundle({snapshotDirectory:source});
 const manifestBytes=await readBoundedManifest(join(source,'manifest.json'));
 const sourceManifestSha256=digest(manifestBytes);
 const core=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)) as {
  files:HashedFile[];
 };
 if(!Array.isArray(core.files)||core.files.length!==3||
    core.files[0]?.path!=='registry.sqlite'||
    core.files[1]?.path!=='diagnosis-journal.sqlite'||
    core.files[2]?.path!=='managed-recovery/manifest.json')
  throw new Error('Unexpected core recovery snapshot inventory');
 const managedBytes=await readBoundedManifest(join(source,'managed-recovery','manifest.json'));
 if(digest(managedBytes)!==core.files[2].sha256)
  throw new Error('Changed nested managed recovery manifest');
 const nested=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(managedBytes)) as {
  files:HashedFile[];
 };
 if(!Array.isArray(nested.files)||nested.files.length>5000)
  throw new Error('Invalid managed recovery file inventory');
 const files=nested.files;
 let totalManagedBytes=0;
 for(const item of files){
  if(!item||typeof item.path!=='string'||!managedPath.test(item.path)||
     typeof item.sha256!=='string'||!hex.test(item.sha256)||
     !Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>512*1024)
   throw new Error('Unsafe managed recovery file entry');
  totalManagedBytes+=item.bytes;
  if(totalManagedBytes>256*1024*1024)
   throw new Error('Managed offline recovery data exceeds size budget');
 }
 await mkdir(target,{recursive:false,mode:0o700});
 for(const item of core.files.slice(0,2)){
  await copyChecked(join(source,item.path),join(target,item.path),item);
 }
 if(files.length){
  await mkdir(join(target,'managed'));
  const created=new Set<string>();
  for(const item of files){
   const [,scriptId,fileName]=item.path.split('/');
   if(!created.has(scriptId!)){
    await mkdir(join(target,'managed',scriptId!));
    created.add(scriptId!);
   }
   await copyChecked(join(source,'managed-recovery',...item.path.split('/')),
    join(target,'managed',scriptId!,fileName!),item);
  }
 }
 // Inspect the actual staged SQLite copies; source validation alone is not
 // proof that the destination contains compatible standalone databases.
 for(const name of ['registry.sqlite','diagnosis-journal.sqlite'] as const){
  const db=new DatabaseSync(join(target,name),{readOnly:true});
  try{
   if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')
    throw new Error('Invalid staged offline SQLite integrity');
   if(name==='registry.sqlite')assertRegistryV1SnapshotSchema(db);
   else{
    if(db.prepare('PRAGMA user_version').get()?.user_version!==1)
     throw new Error('Invalid staged journal version');
    assertJournalSchemaSafety(db);
    if(db.prepare('PRAGMA foreign_key_check').all().length)
     throw new Error('Staged journal foreign key mismatch');
   }
  }finally{db.close();}
 }
 // If a source file changed during copying, its manifest audit must no longer
 // be trusted. Do not mark a partial or moving snapshot as complete.
 await verifyCoreRecoveryBundle({snapshotDirectory:source});
 if(digest(await readBoundedManifest(join(source,'manifest.json')))!==sourceManifestSha256)
  throw new Error('Source recovery manifest changed while staging');
 if(beforeFinalMarker){
  if(typeof beforeFinalMarker!=='function')
   throw new Error('Invalid offline recovery fault-injection dependency');
  await beforeFinalMarker();
 }
 // A trusted source snapshot is not proof that its newly copied staging
 // output stayed intact while SQLite and source audits were awaited.
 await assertUnlinkedRecoveryDirectory(target);
 const expectedRoot=['registry.sqlite','diagnosis-journal.sqlite',...(files.length?['managed']:[])].sort();
 if(JSON.stringify((await readdir(target)).sort())!==JSON.stringify(expectedRoot))
  throw new Error('Unexpected staged offline recovery root entries');
 for(const item of core.files.slice(0,2))
  await assertStagedCopy(join(target,item.path),item);
 if(files.length){
  const managed=join(target,'managed');
  await assertUnlinkedRecoveryDirectory(managed);
  const expectedIds=[...new Set(files.map(item=>item.path.split('/')[1]!))].sort();
  if(JSON.stringify((await readdir(managed)).sort())!==JSON.stringify(expectedIds))
   throw new Error('Unexpected staged offline recovery script directories');
  for(const id of expectedIds){
   const folder=join(managed,id);
   await assertUnlinkedRecoveryDirectory(folder);
   const expectedNames=files.filter(item=>item.path.split('/')[1]===id)
    .map(item=>item.path.split('/')[2]!).sort();
   if(JSON.stringify((await readdir(folder)).sort())!==JSON.stringify(expectedNames))
    throw new Error('Unexpected staged offline recovery revision entries');
  }
  for(const item of files)
   await assertStagedCopy(join(target,...item.path.split('/')),item);
 }
 const record={
  kind:'usshm-core-offline-stage-v1',
  activated:false,
  includesBrowserProfiles:false,
  includesSecrets:false,
  includesOriginalUserscripts:false,
  atomicAcrossStores:false,
  scope:'registry+journal+managed-revisions-only',
  sourceManifestSha256,
  fileCount:2+files.length,
  note:'NON-ACTIVE. Review offline before any separate, explicit migration; never overwrite a running Data directory.',
 };
 await writeFile(join(target,'USSHM-RECOVERY-NOT-ACTIVE.json'),
  JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
 return {path:target,fileCount:record.fileCount,sourceManifestSha256};
}


/**
 * Re-audit an EXISTING, non-active offline staging tree.
 *
 * Complements the pre-marker gate: a stage can change after its creator
 * returns. Only the verified backup inventory is an input to this audit.
 * This function NEVER activates, restores, repairs or modifies any Data.
 *
 * The hashes prove consistency with the selected bundle, not its authorship,
 * and no path-only audit can prevent a future hostile filesystem mutation.
 */
export async function verifyCoreOfflineRecoveryStage({
 snapshotDirectory,stagedDirectory,beforeFinalStageAudit,
}:{
 readonly snapshotDirectory:string;readonly stagedDirectory:string;
 /** Internal deterministic fault injection; never exposed through desktop IPC. */
 readonly beforeFinalStageAudit?:()=>Promise<void>;
}):Promise<{valid:true;fileCount:number;sourceManifestSha256:string}>{
 if(typeof snapshotDirectory!=='string'||!isAbsolute(snapshotDirectory)||
    typeof stagedDirectory!=='string'||!isAbsolute(stagedDirectory))
  throw new Error('Absolute offline recovery audit paths required');
 const source=resolve(snapshotDirectory),stage=resolve(stagedDirectory);
 await assertUnlinkedRecoveryDirectory(source);
 await assertUnlinkedRecoveryDirectory(stage);
 await verifyCoreRecoveryBundle({snapshotDirectory:source});
 const sourceManifest=await readBoundedManifest(join(source,'manifest.json'));
 const sourceManifestSha256=digest(sourceManifest);
 const core=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(sourceManifest)) as {
  files:HashedFile[];
 };
 if(!Array.isArray(core.files)||core.files.length!==3||
    core.files[0]?.path!=='registry.sqlite'||
    core.files[1]?.path!=='diagnosis-journal.sqlite'||
    core.files[2]?.path!=='managed-recovery/manifest.json')
  throw new Error('Invalid offline stage source inventory');
 const nestedManifest=await readBoundedManifest(join(source,'managed-recovery','manifest.json'));
 if(digest(nestedManifest)!==core.files[2].sha256||
    nestedManifest.length!==core.files[2].bytes)
  throw new Error('Offline stage source managed manifest changed');
 const nested=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(nestedManifest)) as {
  files:HashedFile[];
 };
 if(!Array.isArray(nested.files)||nested.files.length>5000)
  throw new Error('Invalid offline stage managed inventory');
 const files=nested.files;
 let sum=0;
 const listed=new Set<string>();
 for(const item of files){
  if(!item||typeof item.path!=='string'||!managedPath.test(item.path)||
     typeof item.sha256!=='string'||!hex.test(item.sha256)||
     !Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>512*1024||
     listed.has(item.path))
   throw new Error('Unsafe offline stage source file inventory');
  listed.add(item.path);
  sum+=item.bytes;
  if(sum>256*1024*1024)
   throw new Error('Oversized offline stage source files');
 }
 const markerPath=join(stage,'USSHM-RECOVERY-NOT-ACTIVE.json');
 const info=await lstat(markerPath);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
    info.size>1024*1024)
  throw new Error('Unsafe offline stage completion marker');
 const markerBytes=await readPinnedRegularFile(markerPath,{
  maxBytes:1024*1024,expected:info,expectedNative:await lstat(markerPath,{bigint:true}),
 });
 if((await lstat(markerPath)).nlink!==1)
  throw new Error('Unsafe offline stage completion marker hardlink');
 let marker:Record<string,unknown>;
 try{
  const parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(markerBytes));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
   throw new Error('Wrong marker shape');
  marker=parsed as Record<string,unknown>;
 }catch{throw new Error('Invalid offline stage completion marker encoding');}
 const required=[
  'kind','activated','includesBrowserProfiles','includesSecrets',
  'includesOriginalUserscripts','atomicAcrossStores','scope',
  'sourceManifestSha256','fileCount','note'
 ].sort();
 if(JSON.stringify(Object.keys(marker).sort())!==JSON.stringify(required)||
    marker.kind!=='usshm-core-offline-stage-v1'||marker.activated!==false||
    marker.includesBrowserProfiles!==false||marker.includesSecrets!==false||
    marker.includesOriginalUserscripts!==false||
    marker.atomicAcrossStores!==false||
    marker.scope!=='registry+journal+managed-revisions-only'||
    marker.sourceManifestSha256!==sourceManifestSha256||
    marker.fileCount!==2+files.length||
    marker.note!=='NON-ACTIVE. Review offline before any separate, explicit migration; never overwrite a running Data directory.')
  throw new Error('Invalid or tampered offline stage completion marker');

 // Source revalidation can be slow, especially with thousands of managed
 // revisions. Finish it BEFORE the final staged inventory and byte checks:
 // otherwise a stage rewritten during source verification can be accepted.
 await verifyCoreRecoveryBundle({snapshotDirectory:source});
 if(digest(await readBoundedManifest(join(source,'manifest.json')))!==sourceManifestSha256)
  throw new Error('Offline stage source manifest changed during audit');
 if(beforeFinalStageAudit){
  // Test-only fault injection; no renderer or production caller supplies it.
  if(typeof beforeFinalStageAudit!=='function')
   throw new Error('Invalid offline stage final-audit dependency');
  await beforeFinalStageAudit();
 }
 // The last complete file inspection covers actual staged outputs, including
 // unexpected entries, directory aliases, verified hashes and SQLite schemas.
 await assertUnlinkedRecoveryDirectory(stage);
 const rootNames=(await readdir(stage)).sort();
 const expectedRoot=['USSHM-RECOVERY-NOT-ACTIVE.json',
  'registry.sqlite','diagnosis-journal.sqlite',...(files.length?['managed']:[])].sort();
 if(JSON.stringify(rootNames)!==JSON.stringify(expectedRoot))
  throw new Error('Unexpected offline stage files');
 for(const item of core.files.slice(0,2))
  await assertStagedCopy(join(stage,item.path),item);
 if(files.length){
  const managed=join(stage,'managed');
  await assertUnlinkedRecoveryDirectory(managed);
  const ids=[...new Set(files.map(v=>v.path.split('/')[1]!))].sort();
  if(JSON.stringify((await readdir(managed)).sort())!==JSON.stringify(ids))
   throw new Error('Unexpected offline stage managed directories');
  for(const id of ids){
   const dir=join(managed,id);
   await assertUnlinkedRecoveryDirectory(dir);
   const expected=files.filter(v=>v.path.split('/')[1]===id)
    .map(v=>v.path.split('/')[2]!).sort();
   if(JSON.stringify((await readdir(dir)).sort())!==JSON.stringify(expected))
    throw new Error('Unexpected offline stage managed revisions');
  }
  for(const item of files)
   await assertStagedCopy(join(stage,...item.path.split('/')),item);
 }
 // Verify schema from the actual staged database copies, never from active Data.
 for(const name of ['registry.sqlite','diagnosis-journal.sqlite'] as const){
  const db=new DatabaseSync(join(stage,name),{readOnly:true});
  try{
   if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')
    throw new Error('Invalid offline staged SQLite integrity');
   if(name==='registry.sqlite')assertRegistryV1SnapshotSchema(db);
   else{
    if(db.prepare('PRAGMA user_version').get()?.user_version!==1)
     throw new Error('Invalid offline staged journal version');
    assertJournalSchemaSafety(db);
    if(db.prepare('PRAGMA foreign_key_check').all().length)
     throw new Error('Invalid offline staged journal foreign keys');
   }
  }finally{db.close();}
 }
 if(!(await readBoundedManifest(markerPath)).equals(markerBytes)||
    (await lstat(markerPath)).nlink!==1)
  throw new Error('Offline stage completion marker changed during audit');
 return {valid:true,fileCount:2+files.length,sourceManifestSha256};
}
