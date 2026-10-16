import {createHash} from 'node:crypto';
import {lstat,mkdir,readdir,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {DatabaseSync} from 'node:sqlite';
import {assertRecoveryDestinationOutsideSource} from '../../runtime-paths/src/recovery-destination.ts';
import {assertRegistryV1SnapshotSchema} from '../../persistence/src/index.ts';
import {assertJournalSchemaSafety} from '../../job-journal/src/index.ts';
import {assertUnlinkedRecoveryDirectory} from '../../runtime-paths/src/recovery-directory.ts';
import {shaFile,verifyCoreRecoveryBundle} from './core-recovery.ts';
import {copyPinnedRecoveryFile} from './recovery-copy.ts';
import {assertSiteTestCaseRegistryBytes} from '../../candidate-engine/src/site-test-cases.ts';
const SCENE_FILE='site-test-cases.json';
const sceneScope='registry+journal+managed-revisions+site-test-cases-only';

const hex=/^[a-f0-9]{64}$/;
const managedPath=/^managed\/[A-Za-z0-9_-]{1,64}\/(?:current\.user\.js|(?:original|revision)-[a-f0-9]{64}\.user\.js)$/;
type HashedFile={path:string;sha256:string;bytes:number};
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
/**
 * Bind a NON-ACTIVE recovery staging directory to its native identity.
 * Identical copied contents cannot inherit approval from a replaced root.
 * An optimistic fence only, not a Win32 FileIdInfo guarantee or atomic lock.
 */
async function pinOfflineStageDirectory(path:string):Promise<()=>Promise<void>>{
 await assertUnlinkedRecoveryDirectory(path);
 const before=await lstat(path,{bigint:true});
 if(!before.isDirectory()||before.isSymbolicLink())
  throw new Error('Unsafe offline stage directory');
 return async()=>{
  await assertUnlinkedRecoveryDirectory(path);
  const current=await lstat(path,{bigint:true});
  if(!current.isDirectory()||current.isSymbolicLink()||
     current.dev!==before.dev||current.ino!==before.ino||
     current.birthtimeNs!==before.birthtimeNs||current.mode!==before.mode)
   throw new Error('Offline stage directory identity changed during audit');
 };
}

/**
 * Revalidate the actual staged pathname and bounded bytes, not merely the
 * initial copy. The stage is a NON-ACTIVE recovery review output, but a
 * completed marker must never bless a later swap, hardlink or same-size edit.
 */
async function assertStagedCopy(path:string,expected:HashedFile):Promise<void>{
 await assertUnlinkedRecoveryDirectory(dirname(path));
 // Hash bytes through one pinned, bounded descriptor instead of reopening
 // the pathname with createReadStream() after a separate lstat() preflight.
 // This rejects late rename/symlink swaps without reading foreign content.
 const actual=await shaFile(path,expected.bytes);
 if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)
  throw new Error('Staged offline recovery file hash or length mismatch');
}

async function readBoundedManifest(path:string):Promise<Buffer>{
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024)
  throw new Error('Unsafe offline recovery manifest');
 return readPinnedRegularFile(path,{maxBytes:1024*1024,expected:info,expectedNative:await lstat(path,{bigint:true})});
}
async function copyChecked(source:string,destination:string,expected:HashedFile){
 // Never use path-only copyFile after validating the snapshot: another writer
 // could replace the source with a symlink between lstat and the actual copy.
 await copyPinnedRecoveryFile({source,destination,expected});
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
 const source=resolve(snapshotDirectory),target=resolve(destination);
 // Feed original lexical paths to guards before using normalized lookups.
 await assertUnlinkedRecoveryDirectory(snapshotDirectory);
 await assertUnlinkedRecoveryDirectory(activeDataRoot);
 await assertUnlinkedRecoveryDirectory(dirname(target));
 // Protect both source snapshot and currently running Data from accidental
 // nesting, symlink/junction aliases, and recursive self-copy.
 await assertRecoveryDestinationOutsideSource(snapshotDirectory,destination);
 await assertRecoveryDestinationOutsideSource(activeDataRoot,destination);
 // Full integrity and schema validation happens BEFORE any destination write.
 await verifyCoreRecoveryBundle({snapshotDirectory:source});
 const manifestBytes=await readBoundedManifest(join(source,'manifest.json'));
 const sourceManifestSha256=digest(manifestBytes);
 const core=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)) as {
  files:HashedFile[];
 };
 const hasCases=core.files?.length===4;
 if(!Array.isArray(core.files)||(core.files.length!==3&&!hasCases)||
    core.files[0]?.path!=='registry.sqlite'||
    core.files[1]?.path!=='diagnosis-journal.sqlite'||
    core.files[2]?.path!=='managed-recovery/manifest.json'||
    (hasCases&&core.files[3]?.path!==SCENE_FILE))
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
 const assertTargetDirectoryIdentity=await pinOfflineStageDirectory(target);
 for(const item of core.files.slice(0,2)){
  await copyChecked(join(source,item.path),join(target,item.path),item);
 }
 if(hasCases){
  const entry=core.files[3]!;
  if(entry.bytes<1||entry.bytes>131072)throw new Error('Unsafe site test case recovery byte budget');
  await copyChecked(join(source,SCENE_FILE),join(target,SCENE_FILE),entry);
  assertSiteTestCaseRegistryBytes(await readBoundedManifest(join(target,SCENE_FILE)));
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
 if(beforeFinalMarker){
  if(typeof beforeFinalMarker!=='function')
   throw new Error('Invalid offline recovery fault-injection dependency');
  await beforeFinalMarker();
 }
 // A trusted source snapshot is not proof that its newly copied staging
 // output stayed intact while SQLite and source audits were awaited.
 await assertTargetDirectoryIdentity();
 const expectedRoot=['registry.sqlite','diagnosis-journal.sqlite',...(files.length?['managed']:[]),...(hasCases?[SCENE_FILE]:[])].sort();
 if(JSON.stringify((await readdir(target)).sort())!==JSON.stringify(expectedRoot))
  throw new Error('Unexpected staged offline recovery root entries');
 for(const item of core.files.slice(0,2))
  await assertStagedCopy(join(target,item.path),item);
 if(hasCases){
  await assertStagedCopy(join(target,SCENE_FILE),core.files[3]!);
  assertSiteTestCaseRegistryBytes(await readBoundedManifest(join(target,SCENE_FILE)));
 }
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
 // The fault hook and all staged-file audits may run AFTER the earlier
 // source check. Revalidate the ORIGINAL backup as the last read-only fence
 // before publishing a stage completion marker, so a concurrent late
 // mutation of the source cannot be blessed by a previously valid digest.
 // This still does not promise atomicity across unrelated processes.
 // If a source file changed during copying, its manifest audit must no longer
 // be trusted. Do not mark a partial or moving snapshot as complete.
 await verifyCoreRecoveryBundle({snapshotDirectory:source});
 if(digest(await readBoundedManifest(join(source,'manifest.json')))!==sourceManifestSha256)
  throw new Error('Source recovery manifest changed while staging');
 const record={
  kind:'usshm-core-offline-stage-v1',
  activated:false,
  includesBrowserProfiles:false,
  includesSecrets:false,
  includesOriginalUserscripts:false,
  atomicAcrossStores:false,
  scope:hasCases?sceneScope:'registry+journal+managed-revisions-only',
  sourceManifestSha256,
  fileCount:2+files.length+(hasCases?1:0),
  note:'NON-ACTIVE. Review offline before any separate, explicit migration; never overwrite a running Data directory.',
 };
 // Source verification may be lengthy; the exclusive directory claim must
 // still name this operation's original directory at marker publication.
 await assertTargetDirectoryIdentity();
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
 snapshotDirectory,stagedDirectory,beforeFinalStageAudit,beforeSqliteSchemaAudit,
}:{
 readonly snapshotDirectory:string;readonly stagedDirectory:string;
 /** Internal deterministic fault injection; never exposed through desktop IPC. */
 readonly beforeFinalStageAudit?:()=>Promise<void>;
 /** Internal deterministic fault injection after staged hashes and before SQLite pathname reopen. */
 readonly beforeSqliteSchemaAudit?:()=>Promise<void>;
}):Promise<{valid:true;fileCount:number;sourceManifestSha256:string}>{
 if(typeof snapshotDirectory!=='string'||!isAbsolute(snapshotDirectory)||
    typeof stagedDirectory!=='string'||!isAbsolute(stagedDirectory))
  throw new Error('Absolute offline recovery audit paths required');
 const source=resolve(snapshotDirectory),stage=resolve(stagedDirectory);
 await assertUnlinkedRecoveryDirectory(snapshotDirectory);
 await assertUnlinkedRecoveryDirectory(stagedDirectory);
 // Bind the entire NON-ACTIVE directory object before any lengthy audits.
 // File and marker identity checks alone cannot attest the selected root.
 // This is a bounded native-stats defense, NOT a Win32 FileIdInfo guarantee
 // or an atomic lock against all hostile concurrent filesystem mutations.
 const assertStageDirectoryIdentity=await pinOfflineStageDirectory(stage);
 await verifyCoreRecoveryBundle({snapshotDirectory:source});
 const sourceManifest=await readBoundedManifest(join(source,'manifest.json'));
 const sourceManifestSha256=digest(sourceManifest);
 const core=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(sourceManifest)) as {
  files:HashedFile[];
 };
 const hasCases=core.files?.length===4;
 if(!Array.isArray(core.files)||(core.files.length!==3&&!hasCases)||
    core.files[0]?.path!=='registry.sqlite'||
    core.files[1]?.path!=='diagnosis-journal.sqlite'||
    core.files[2]?.path!=='managed-recovery/manifest.json'||
    (hasCases&&core.files[3]?.path!==SCENE_FILE))
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
 const markerNative=await lstat(markerPath,{bigint:true});
 const markerBytes=await readPinnedRegularFile(markerPath,{
  maxBytes:1024*1024,expected:info,expectedNative:markerNative,
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
    marker.scope!==(hasCases?sceneScope:'registry+journal+managed-revisions-only')||
    marker.sourceManifestSha256!==sourceManifestSha256||
    marker.fileCount!==2+files.length+(hasCases?1:0)||
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
 // The last complete file inspection must still address the SAME directory
 // selected before the slow backup audit, not merely the same pathname.
 await assertStageDirectoryIdentity();
 const rootNames=(await readdir(stage)).sort();
 const expectedRoot=['USSHM-RECOVERY-NOT-ACTIVE.json',
  'registry.sqlite','diagnosis-journal.sqlite',...(files.length?['managed']:[]),...(hasCases?[SCENE_FILE]:[])].sort();
 if(JSON.stringify(rootNames)!==JSON.stringify(expectedRoot))
  throw new Error('Unexpected offline stage files');
 for(const item of core.files.slice(0,2))
  await assertStagedCopy(join(stage,item.path),item);
 if(hasCases){
  await assertStagedCopy(join(stage,SCENE_FILE),core.files[3]!);
  assertSiteTestCaseRegistryBytes(await readBoundedManifest(join(stage,SCENE_FILE)));
 }
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
 if(beforeSqliteSchemaAudit){
  // Test-only boundary for the unavoidable pathname reopen below; never exposed
  // to Electron IPC or a production caller.
  if(typeof beforeSqliteSchemaAudit!=='function')
   throw new Error('Invalid offline stage SQLite-audit dependency');
  await beforeSqliteSchemaAudit();
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
 // DatabaseSync necessarily reopens these files by pathname. A distinct but
 // structurally valid SQLite file could otherwise replace the bytes that were
 // hashed immediately before this loop and still pass schema/integrity checks.
 // Re-pin both SQLite paths and verify the source-approved bytes/identity after
 // the schema reads. This narrows that reopen TOCTOU window; it is not a
 // cross-process filesystem lock or native Win32 FileIdInfo attestation.
 for(const item of core.files.slice(0,2))
  await assertStagedCopy(join(stage,item.path),item);
 // The final marker must be the SAME pinned file object originally
 // approved, not merely newly substituted byte-identical JSON. In particular,
 // never follow a late symlink or trust a replacement with the same SHA-256.
 // This narrows a concurrent pathname swap; it is not an atomic filesystem lock.
 const finalMarker=await readPinnedRegularFile(markerPath,{
  maxBytes:1024*1024,expected:info,expectedNative:markerNative,
 });
 if(!finalMarker.equals(markerBytes))
  throw new Error('Offline stage completion marker changed during audit');
 // Staged bytes and the marker can remain valid even when another process
 // corrupts the SOURCE snapshot while this independent review awaits stage
 // hashes and SQLite checks. Re-audit the original backup as the final gate;
 // never return valid:true on the strength of an earlier source verification.
 // This is fail-closed verification, not a cross-process atomicity guarantee.
 await verifyCoreRecoveryBundle({snapshotDirectory:source});
 if(digest(await readBoundedManifest(join(source,'manifest.json')))!==sourceManifestSha256)
  throw new Error('Offline stage source snapshot changed during independent audit');
 await assertStageDirectoryIdentity();
 return {valid:true,fileCount:2+files.length+(hasCases?1:0),sourceManifestSha256};
}
