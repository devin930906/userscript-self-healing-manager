import {createHash} from 'node:crypto';
import {constants,createReadStream} from 'node:fs';
import {copyFile,lstat,mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {assertRecoveryDestinationOutsideSource} from '../../runtime-paths/src/recovery-destination.ts';
import {assertRegistryV1SnapshotSchema} from '../../persistence/src/index.ts';
import {assertJournalSchemaSafety} from '../../job-journal/src/index.ts';
import {verifyCoreRecoveryBundle} from './core-recovery.ts';

const hex=/^[a-f0-9]{64}$/;
const managedPath=/^managed\/[A-Za-z0-9_-]{1,64}\/(?:current\.user\.js|(?:original|revision)-[a-f0-9]{64}\.user\.js)$/;
type HashedFile={path:string;sha256:string;bytes:number};
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');

async function safeDirectory(folder:string){
 const info=await lstat(folder);
 if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe offline recovery directory');
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
 const hash=createHash('sha256');
 let copied=0;
 for await(const part of createReadStream(destination)){
  copied+=(part as Buffer).byteLength;
  if(copied>expected.bytes)throw new Error('Offline recovery copy exceeded source byte budget');
  hash.update(part);
 }
 if(copied!==expected.bytes||hash.digest('hex')!==expected.sha256)
  throw new Error('Offline recovery copied file hash mismatch');
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
 snapshotDirectory,activeDataRoot,destination,
}:{
 readonly snapshotDirectory:string;readonly activeDataRoot:string;readonly destination:string;
}):Promise<{path:string;fileCount:number;sourceManifestSha256:string}>{
 if([snapshotDirectory,activeDataRoot,destination].some(p=>
   typeof p!=='string'||!isAbsolute(p)))
  throw new Error('Absolute offline recovery paths required');
 const source=resolve(snapshotDirectory),active=resolve(activeDataRoot),target=resolve(destination);
 await safeDirectory(source);
 await safeDirectory(active);
 await safeDirectory(dirname(target));
 // Protect both source snapshot and currently running Data from accidental
 // nesting, symlink/junction aliases, and recursive self-copy.
 await assertRecoveryDestinationOutsideSource(source,target);
 await assertRecoveryDestinationOutsideSource(active,target);
 // Full integrity and schema validation happens BEFORE any destination write.
 await verifyCoreRecoveryBundle({snapshotDirectory:source});
 const manifestBytes=await readFile(join(source,'manifest.json'));
 if(manifestBytes.byteLength>1024*1024)
  throw new Error('Oversized recovery source manifest');
 const sourceManifestSha256=digest(manifestBytes);
 const core=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)) as {
  files:HashedFile[];
 };
 if(!Array.isArray(core.files)||core.files.length!==3||
    core.files[0]?.path!=='registry.sqlite'||
    core.files[1]?.path!=='diagnosis-journal.sqlite'||
    core.files[2]?.path!=='managed-recovery/manifest.json')
  throw new Error('Unexpected core recovery snapshot inventory');
 const managedBytes=await readFile(join(source,'managed-recovery','manifest.json'));
 if(managedBytes.byteLength>1024*1024||
    digest(managedBytes)!==core.files[2].sha256)
  throw new Error('Changed nested managed recovery manifest');
 const nested=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(managedBytes)) as {
  files:HashedFile[];
 };
 if(!Array.isArray(nested.files)||nested.files.length>5000)
  throw new Error('Invalid managed recovery file inventory');
 const files=nested.files;
 for(const item of files){
  if(!item||typeof item.path!=='string'||!managedPath.test(item.path)||
     typeof item.sha256!=='string'||!hex.test(item.sha256)||
     !Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>512*1024)
   throw new Error('Unsafe managed recovery file entry');
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
 if(digest(await readFile(join(source,'manifest.json')))!==sourceManifestSha256)
  throw new Error('Source recovery manifest changed while staging');
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
