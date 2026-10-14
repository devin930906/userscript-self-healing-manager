import {createHash} from 'node:crypto';
import {constants,type BigIntStats} from 'node:fs';
import {lstat,mkdir,open,readdir,writeFile} from 'node:fs/promises';
import {assertSiteTestCaseRegistryBytes} from '../../candidate-engine/src/site-test-cases.ts';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {assertUnlinkedRecoveryDirectory} from '../../runtime-paths/src/recovery-directory.ts';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {assertRecoveryDestinationOutsideSource} from '../../runtime-paths/src/recovery-destination.ts';
import {DatabaseSync} from 'node:sqlite';
import {assertRegistryV1SnapshotSchema,backupRegistryDatabase,type DatabaseHandle} from '../../persistence/src/index.ts';
import {assertJournalSchemaSafety,type DiagnosisJournal} from '../../job-journal/src/index.ts';
import {exportManagedRecovery,verifyManagedRecovery} from './managed-export.ts';

type ManifestFile={readonly path:string;readonly sha256:string;readonly bytes:number};
const paths=['registry.sqlite','diagnosis-journal.sqlite','managed-recovery/manifest.json'] as const;
const SCENE_FILE='site-test-cases.json';
const sceneScope='registry+journal+managed-revisions+site-test-cases-only';
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
/** RG-06 exact Node BigIntStats identity for the *read-only* recovery
 * SQLite/manifest hashing path. This supplements SHA-256 and nlink checks,
 * but does NOT certify native Win32 FileIdInfo or prevent hostile rename races.
 */
export function sameCoreRecoveryNativeIdentity(left:BigIntStats,right:BigIntStats):boolean{
 return left.isFile()&&!left.isSymbolicLink()&&
  right.isFile()&&!right.isSymbolicLink()&&
  left.nlink===1n&&right.nlink===1n&&
  left.dev===right.dev&&left.ino===right.ino&&
  left.birthtimeNs===right.birthtimeNs&&
  left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs&&
  left.mode===right.mode&&left.size===right.size;
}

function hasOnlyKeys(value:unknown,keys:readonly string[]):boolean{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&
  keys.every(k=>Object.prototype.hasOwnProperty.call(value,k));
}
async function directory(path:string){
 await assertUnlinkedRecoveryDirectory(path);
}
async function shaFile(file:string,limit=512*1024*1024):Promise<{sha256:string;bytes:number}>{
 const original=await lstat(file);
 const nativeBefore=await lstat(file,{bigint:true});
 if(!original.isFile()||original.isSymbolicLink()||original.size>limit||
    original.size<0||nativeBefore.size!==BigInt(original.size)||
    !sameCoreRecoveryNativeIdentity(nativeBefore,nativeBefore))
  throw new Error('Unsafe or oversized recovery snapshot file');
 // Hash matching is not sufficient if an independent filename can mutate
 // these supposedly isolated SQLite / manifest recovery files.
 if(original.nlink!==1)throw new Error('Unsafe recovery snapshot hardlink alias');
 const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const opened=await handle.stat();
  const nativeOpened=await handle.stat({bigint:true});
  if(!sameCoreRecoveryNativeIdentity(nativeBefore,nativeOpened))
   throw new Error('Recovery native file identity changed before pinned read');
  if(!opened.isFile()||opened.size!==original.size||
     opened.dev!==original.dev||opened.ino!==original.ino)
   throw new Error('Recovery file changed before pinned read');
  if(opened.nlink!==1)throw new Error('Unsafe recovery snapshot hardlink alias on descriptor');
  const digest=createHash('sha256');
  let count=0;
  for await(const block of handle.createReadStream({autoClose:false})){
   count+=(block as Buffer).byteLength;
   if(count>limit)throw new Error('Recovery file grew past size budget');
   digest.update(block);
  }
  const after=await handle.stat();
  const nativeAfter=await handle.stat({bigint:true});
  const pathAfter=await lstat(file);
  const nativePathAfter=await lstat(file,{bigint:true});
  if(!sameCoreRecoveryNativeIdentity(nativeBefore,nativeAfter)||
     !sameCoreRecoveryNativeIdentity(nativeBefore,nativePathAfter))
   throw new Error('Recovery native file identity changed during hash verification');
  if(count!==opened.size||after.size!==opened.size||pathAfter.size!==opened.size||
     pathAfter.ino!==opened.ino||pathAfter.dev!==opened.dev)
   throw new Error('Recovery snapshot changed during hash verification');
  if(after.nlink!==1||pathAfter.nlink!==1)
   throw new Error('Unsafe recovery snapshot hardlink alias after hash verification');
  return {sha256:digest.digest('hex'),bytes:count};
 }finally{await handle.close();}
}
/**
 * Independently inspect both committed SQLite backup files before publishing
 * a manifest that claims complete:true, not only on a later user-run audit.
 * Reuse exactly the same read-only schema gate during standalone verification.
 */
async function assertCoreSqliteSnapshots(root:string):Promise<void>{
 for(const name of paths.slice(0,2)){
  const db=new DatabaseSync(join(root,name),{readOnly:true});
  try{
   if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')
    throw new Error('Corrupt core SQLite snapshot');
   if(name==='registry.sqlite'){
    assertRegistryV1SnapshotSchema(db);
   }else{
    if(db.prepare('PRAGMA user_version').get()?.user_version!==1)
     throw new Error('Invalid core journal schema');
    assertJournalSchemaSafety(db);
    if(db.prepare('PRAGMA foreign_key_check').all().length)
     throw new Error('Invalid core journal foreign keys');
   }
  }finally{db.close();}
 }
}
/**
 * Consecutive, independently verified registry, journal, and managed revision
 * snapshots. Not a cross-store transaction; arbitrary Data/ files, browser
 * profiles and secrets are deliberately excluded. Never restore automatically.
 */
export async function createCoreRecoveryBundle({dataRoot,destination,registry,journal,beforeFinalManifest}:{
 dataRoot:string;destination:string;registry:DatabaseHandle;journal:DiagnosisJournal;
 /** Internal deterministic fault injection only; never wired from renderer. */
 beforeFinalManifest?:()=>Promise<void>;
}):Promise<{path:string;manifestSha256:string}>{
 if(typeof dataRoot!=='string'||typeof destination!=='string'||
    !isAbsolute(dataRoot)||!isAbsolute(destination)||!(registry instanceof DatabaseSync)||
    (beforeFinalManifest!==undefined&&typeof beforeFinalManifest!=='function'))
  throw new Error('Invalid core recovery input');
 const source=resolve(dataRoot),target=resolve(destination);
 await directory(source);
 await directory(dirname(target));
 await assertRecoveryDestinationOutsideSource(source,target);
 // The new directory is claimed exclusively. If something fails, the folder
 // has no complete manifest, remains for forensic review, and is not deleted.
 await mkdir(target,{recursive:false,mode:0o700});
 const reg=await backupRegistryDatabase(registry,join(target,paths[0]));
 const log=await journal.backupSnapshot(join(target,paths[1]));
 const managed=await exportManagedRecovery({
  managedRoot:source,destination:join(target,'managed-recovery')
 });
 await verifyManagedRecovery({snapshotDirectory:managed.path});
 const archive=await shaFile(join(managed.path,'manifest.json'),1024*1024);
 // A v1 Data root has no scenario registry. Every existing registry, however,
 // must be included or cause recovery creation to fail without a final marker.
 let sceneFile:ManifestFile|null=null;
 const sceneSource=join(source,SCENE_FILE);
 let observedSceneSource=false;
 try{
  const info=await lstat(sceneSource);
  observedSceneSource=true;
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
     info.size<1||info.size>131072)
   throw new Error('Unsafe site test case registry in core recovery');
  const bytes=await readPinnedRegularFile(sceneSource,{
   maxBytes:131072,expected:info,expectedNative:await lstat(sceneSource,{bigint:true}),
  });
  assertSiteTestCaseRegistryBytes(bytes);
  await writeFile(join(target,SCENE_FILE),bytes,{flag:'wx',mode:0o600});
  const copied=await shaFile(join(target,SCENE_FILE),131072);
  if(copied.sha256!==sha(bytes)||copied.bytes!==bytes.byteLength)
   throw new Error('Core recovery site test cases copy differs from approved bytes');
  sceneFile={path:SCENE_FILE,sha256:copied.sha256,bytes:copied.bytes};
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT'||observedSceneSource)
   throw new Error('Site test case registry disappeared or changed during core recovery');
 }
 // A backup callback's SHA-256 and byte count are claims, not independent
 // evidence of what is now on disk. Reopen each staged SQLite file through
 // the bounded descriptor verifier before publishing complete:true.
 for(const [name,claim] of [[paths[0],reg],[paths[1],log]] as const){
  const actual=await shaFile(join(target,name));
  if(actual.sha256!==claim.sha256||actual.bytes!==claim.bytes)
   throw new Error('Core recovery SQLite backup receipt and on-disk snapshot mismatch');
 }
 const files:ManifestFile[]=[
  {path:paths[0],sha256:reg.sha256,bytes:reg.bytes},
  {path:paths[1],sha256:log.sha256,bytes:log.bytes},
  {path:paths[2],sha256:archive.sha256,bytes:archive.bytes},
  ...(sceneFile?[sceneFile]:[])
 ];
 // Do not certify an invalid journal (even with a valid SHA-256) as complete.
 // A failed preflight leaves this new directory incomplete and review-only.
 await assertCoreSqliteSnapshots(target);
 if(beforeFinalManifest)await beforeFinalManifest();
 // A prior valid snapshot does not prove that independently writable files
 // remained intact during the other awaited backup and SQLite audits.
 // Repeat the closed-inventory and byte checks immediately before the only
 // complete:true marker; an adversarial edit must leave the bundle incomplete.
 await directory(target);
 const expectedEntries=['registry.sqlite','diagnosis-journal.sqlite','managed-recovery',...(sceneFile?[SCENE_FILE]:[])].sort();
 if(JSON.stringify((await readdir(target)).sort())!==JSON.stringify(expectedEntries))
  throw new Error('Unexpected core recovery entries before manifest publication');
 await verifyManagedRecovery({snapshotDirectory:managed.path});
 const finalNested=await shaFile(join(managed.path,'manifest.json'),1024*1024);
 if(finalNested.sha256!==archive.sha256||finalNested.bytes!==archive.bytes)
  throw new Error('Core recovery nested manifest changed before publication');
 for(const [name,claim] of [[paths[0],reg],[paths[1],log]] as const){
  const actual=await shaFile(join(target,name));
  if(actual.sha256!==claim.sha256||actual.bytes!==claim.bytes)
   throw new Error('Core recovery SQLite bytes changed before publication');
 }
 await assertCoreSqliteSnapshots(target);
 if(sceneFile){
  const archived=await shaFile(join(target,SCENE_FILE),131072);
  const currentSource=await shaFile(sceneSource,131072);
  if(archived.sha256!==sceneFile.sha256||archived.bytes!==sceneFile.bytes||
     currentSource.sha256!==sceneFile.sha256||currentSource.bytes!==sceneFile.bytes)
   throw new Error('Core recovery site test case registry changed before publication');
  const info=await lstat(join(target,SCENE_FILE));
  assertSiteTestCaseRegistryBytes(await readPinnedRegularFile(join(target,SCENE_FILE),{
   maxBytes:131072,expected:info,expectedNative:await lstat(join(target,SCENE_FILE),{bigint:true}),
  }));
 }else{
  // A brand-new setting can be saved while a legacy core backup is running.
  // Never certify an apparently complete v1 archive that silently omits it.
  try{
   await lstat(sceneSource);
   throw new Error('Site test case registry appeared during core recovery; retry snapshot');
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  }
 }
 const content=Buffer.from(JSON.stringify({
  kind:sceneFile?'usshm-core-recovery-v2':'usshm-core-recovery-v1',complete:true,atomicAcrossStores:false,
  scope:sceneFile?sceneScope:'registry+journal+managed-revisions-only',
  files
 },null,2)+'\n','utf8');
 await writeFile(join(target,'manifest.json'),content,{flag:'wx',mode:0o600});
 return {path:target,manifestSha256:sha(content)};
}
/** Audit core recovery files without installing, running, or restoring scripts. */
export async function verifyCoreRecoveryBundle({snapshotDirectory}:{
 snapshotDirectory:string;
}):Promise<{files:number;valid:true}>{
 if(typeof snapshotDirectory!=='string'||!isAbsolute(snapshotDirectory))
  throw new Error('Absolute recovery directory required');
 const root=resolve(snapshotDirectory);
 await directory(root);
 const entries=(await readdir(root)).sort();
 const manifestFile=join(root,'manifest.json');
 const manifestInfo=await lstat(manifestFile);
 if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink()||manifestInfo.size>1024*1024)
  throw new Error('Unsafe core recovery manifest');
 if(manifestInfo.nlink!==1)throw new Error('Unsafe core recovery manifest hardlink alias');
 const manifestBytes=await readPinnedRegularFile(manifestFile,{maxBytes:1024*1024,expected:manifestInfo,expectedNative:await lstat(manifestFile,{bigint:true})});
 if((await lstat(manifestFile)).nlink!==1)
  throw new Error('Unsafe core recovery manifest hardlink alias after read');
 let manifest:unknown;
 try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));}
 catch{throw new Error('Invalid core recovery manifest encoding or JSON');}
 const obj=manifest as {
  kind?:unknown;complete?:unknown;atomicAcrossStores?:unknown;
  scope?:unknown;files?:unknown;
 }|null;
 const withScenes=obj?.kind==='usshm-core-recovery-v2';
 if(!hasOnlyKeys(obj,['kind','complete','atomicAcrossStores','scope','files'])||
   !obj||(obj.kind!=='usshm-core-recovery-v1'&&!withScenes)||obj.complete!==true||
   obj.atomicAcrossStores!==false||
   obj.scope!==(withScenes?sceneScope:'registry+journal+managed-revisions-only')||
   !Array.isArray(obj.files)||obj.files.length!==(withScenes?4:3))
  throw new Error('Invalid or incomplete core recovery manifest');
 const verifiedPaths=[...paths,...(withScenes?[SCENE_FILE]:[])];
 const expectedRoot=[...paths.slice(0,2),'managed-recovery','manifest.json',...(withScenes?[SCENE_FILE]:[])].sort();
 if(JSON.stringify(entries)!==JSON.stringify(expectedRoot))
  throw new Error('Unexpected core recovery content');
 for(let i=0;i<verifiedPaths.length;i++){
  const file=obj.files[i] as Partial<ManifestFile>|undefined;
  if(!hasOnlyKeys(file,['path','sha256','bytes'])||
     !file||file.path!==verifiedPaths[i]||typeof file.sha256!=='string'||
     !/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||
     typeof file.bytes!=='number'||file.bytes<0)
   throw new Error('Invalid core recovery file manifest');
  const snapshot=await shaFile(join(root,...verifiedPaths[i]!.split('/')),
   i===2?1024*1024:i===3?131072:512*1024*1024);
  if(snapshot.sha256!==file.sha256||snapshot.bytes!==file.bytes)
   throw new Error('Core recovery file hash mismatch');
 }
 // Validate SQLite content, not merely its hash; this is deliberately read-only.
 await assertCoreSqliteSnapshots(root);
 await verifyManagedRecovery({snapshotDirectory:join(root,'managed-recovery')});
 if(withScenes){
  const source=join(root,SCENE_FILE),info=await lstat(source);
  assertSiteTestCaseRegistryBytes(await readPinnedRegularFile(source,{
   maxBytes:131072,expected:info,expectedNative:await lstat(source,{bigint:true}),
  }));
 }
 return {files:verifiedPaths.length,valid:true};
}
