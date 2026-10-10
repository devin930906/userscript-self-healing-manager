import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {backupRegistryDatabase,type DatabaseHandle} from '../../persistence/src/index.ts';
import {type DiagnosisJournal} from '../../job-journal/src/index.ts';
import {exportManagedRecovery,verifyManagedRecovery} from './managed-export.ts';

type ManifestFile={readonly path:string;readonly sha256:string;readonly bytes:number};
const paths=['registry.sqlite','diagnosis-journal.sqlite','managed-recovery/manifest.json'] as const;
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
async function directory(path:string){
 const stat=await lstat(path);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsafe core recovery directory');
}
async function shaFile(file:string,limit=512*1024*1024):Promise<{sha256:string;bytes:number}>{
 const original=await lstat(file);
 if(!original.isFile()||original.isSymbolicLink()||original.size>limit)
  throw new Error('Unsafe or oversized recovery snapshot file');
 const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const opened=await handle.stat();
  if(!opened.isFile()||opened.size!==original.size||
     opened.dev!==original.dev||opened.ino!==original.ino)
   throw new Error('Recovery file changed before pinned read');
  const digest=createHash('sha256');
  let count=0;
  for await(const block of handle.createReadStream()){
   count+=(block as Buffer).byteLength;
   if(count>limit)throw new Error('Recovery file grew past size budget');
   digest.update(block);
  }
  const after=await handle.stat();
  const pathAfter=await lstat(file);
  if(count!==opened.size||after.size!==opened.size||pathAfter.size!==opened.size||
     pathAfter.ino!==opened.ino||pathAfter.dev!==opened.dev)
   throw new Error('Recovery snapshot changed during hash verification');
  return {sha256:digest.digest('hex'),bytes:count};
 }finally{await handle.close();}
}
/**
 * Consecutive, independently verified registry, journal, and managed revision
 * snapshots. Not a cross-store transaction; arbitrary Data/ files, browser
 * profiles and secrets are deliberately excluded. Never restore automatically.
 */
export async function createCoreRecoveryBundle({dataRoot,destination,registry,journal}:{
 dataRoot:string;destination:string;registry:DatabaseHandle;journal:DiagnosisJournal;
}):Promise<{path:string;manifestSha256:string}>{
 if(typeof dataRoot!=='string'||typeof destination!=='string'||
    !isAbsolute(dataRoot)||!isAbsolute(destination)||!(registry instanceof DatabaseSync))
  throw new Error('Invalid core recovery input');
 const source=resolve(dataRoot),target=resolve(destination),rel=relative(source,target);
 if(rel===''||(!rel.startsWith('..')&&!isAbsolute(rel)))
  throw new Error('Core backup cannot be written inside source Data');
 await directory(source);
 await directory(dirname(target));
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
 const files:ManifestFile[]=[
  {path:paths[0],sha256:reg.sha256,bytes:reg.bytes},
  {path:paths[1],sha256:log.sha256,bytes:log.bytes},
  {path:paths[2],sha256:archive.sha256,bytes:archive.bytes}
 ];
 const content=Buffer.from(JSON.stringify({
  kind:'usshm-core-recovery-v1',complete:true,atomicAcrossStores:false,
  scope:'registry+journal+managed-revisions-only',
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
 if(JSON.stringify(entries)!==JSON.stringify([...paths.slice(0,2),'managed-recovery','manifest.json'].sort()))
  throw new Error('Unexpected core recovery content');
 const manifestFile=join(root,'manifest.json');
 const manifestInfo=await lstat(manifestFile);
 if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink()||manifestInfo.size>1024*1024)
  throw new Error('Unsafe core recovery manifest');
 const manifestBytes=await readFile(manifestFile);
 let manifest:unknown;
 try{manifest=JSON.parse(manifestBytes.toString('utf8'));}catch{throw new Error('Invalid core recovery manifest');}
 const obj=manifest as {kind?:unknown;complete?:unknown;atomicAcrossStores?:unknown;files?:unknown}|null;
 if(!obj||obj.kind!=='usshm-core-recovery-v1'||obj.complete!==true||
   obj.atomicAcrossStores!==false||!Array.isArray(obj.files)||obj.files.length!==3)
  throw new Error('Invalid or incomplete core recovery manifest');
 for(let i=0;i<paths.length;i++){
  const file=obj.files[i] as Partial<ManifestFile>|undefined;
  if(!file||file.path!==paths[i]||typeof file.sha256!=='string'||
     !/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||
     typeof file.bytes!=='number'||file.bytes<0)
   throw new Error('Invalid core recovery file manifest');
  const snapshot=await shaFile(join(root,...paths[i].split('/')),
   i===2?1024*1024:512*1024*1024);
  if(snapshot.sha256!==file.sha256||snapshot.bytes!==file.bytes)
   throw new Error('Core recovery file hash mismatch');
 }
 // Validate SQLite content, not merely its hash; this is deliberately read-only.
 for(const name of paths.slice(0,2)){
  const db=new DatabaseSync(join(root,name),{readOnly:true});
  try{
   if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')
    throw new Error('Corrupt core SQLite snapshot');
   if(name==='registry.sqlite'){
    const v=db.prepare('SELECT version FROM schema_version LIMIT 2').all();
    if(v.length!==1||v[0]?.version!==1)throw new Error('Invalid core registry schema');
   }else if(db.prepare('PRAGMA user_version').get()?.user_version!==1||
             db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Invalid core journal schema');
  }finally{db.close();}
 }
 await verifyManagedRecovery({snapshotDirectory:join(root,'managed-recovery')});
 return {files:3,valid:true};
}
