import {createHash} from 'node:crypto';
import {lstat,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,dirname} from 'node:path';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';

export interface ManagedRecoveryFile {
 readonly path:string;
 readonly sha256:string;
 readonly bytes:number;
}
export interface ManagedRecoveryReceipt {
 readonly path:string;
 readonly files:readonly ManagedRecoveryFile[];
}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const ARCHIVE=/^(original|revision)-([a-f0-9]{64})\.user\.js$/;
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const LIMIT_FILES=5000, LIMIT_TOTAL=256*1024*1024, LIMIT_EACH=512*1024;
async function safeDir(path:string):Promise<boolean>{
 try{
  const stat=await lstat(path);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Unsafe managed recovery directory');
  return true;
 }catch(e){
  if((e as NodeJS.ErrnoException).code==='ENOENT')return false;
  throw e;
 }
}
/**
 * Export the verified managed script archives to a NEW local directory.
 *
 * Scope: managed/<script-id>/{original-hash,revision-hash,current}.user.js.
 * Registry/journal SQLite, adapters, browser profiles, secrets and arbitrary
 * Data/ files are intentionally excluded. No original user script is read
 * or modified; no staging/lock remnants are cleared automatically.
 *
 * A manifest with complete=true is written LAST. If a filesystem write fails
 * the output remains incomplete (no manifest) rather than being promoted to
 * a valid recovery artifact. Never delete a partial directory automatically.
 */
export async function exportManagedRecovery(input:{
 managedRoot:string;destination:string;
}):Promise<ManagedRecoveryReceipt>{
 const {managedRoot,destination}=input;
 if(typeof managedRoot!=='string'||typeof destination!=='string'||
    !isAbsolute(managedRoot)||!isAbsolute(destination))
  throw new Error('Absolute source and destination are required');
 const source=resolve(managedRoot),target=resolve(destination);
 const inside=relative(source,target);
 if(inside===''||(!inside.startsWith('..')&&!isAbsolute(inside)))
  throw new Error('Backup destination cannot be inside source Data');
 if(!(await safeDir(source))||!(await safeDir(dirname(target))))
  throw new Error('Missing or unsafe recovery source/destination directory');
 const managed=join(source,'managed');
 const managedExists=await safeDir(managed);
 const scriptIds=managedExists?(await readdir(managed)).sort():[];
 if(scriptIds.length>1000)throw new Error('Too many managed scripts to back up');
 // mkdir without recursive is an exclusive new-directory claim: no overwrite.
 await mkdir(target,{recursive:false,mode:0o700});
 const files:ManagedRecoveryFile[]=[];
 let total=0;
 if(managedExists){
  await mkdir(join(target,'managed'));
  for(const scriptId of scriptIds){
   if(!ID.test(scriptId))throw new Error('Unsafe managed script directory name');
   const folder=join(managed,scriptId);
   if(!(await safeDir(folder)))throw new Error('Missing managed script directory');
   const names=(await readdir(folder)).sort();
   if(names.length>LIMIT_FILES)throw new Error('Managed archive exceeds file cap');
   const archived=new Set<string>();
   for(const name of names){
    const m=ARCHIVE.exec(name);
    if(m)archived.add(m[2]!);
    else if(name!=='current.user.js')
     throw new Error('Unsafe or unexpected managed archive entry (lock, staging or symlink)');
   }
   await mkdir(join(target,'managed',scriptId));
   for(const name of names){
    const path=join(folder,name),info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink()||info.size>LIMIT_EACH)
     throw new Error('Unsafe managed file or oversized revision');
    const bytes=await readPinnedRegularFile(path,{maxBytes:LIMIT_EACH,expected:info});
    const digest=hash(bytes);
    const m=ARCHIVE.exec(name);
    if(m&&m[2]!==digest)throw new Error('Managed immutable revision hash mismatch');
    if(name==='current.user.js'&&!archived.has(digest))
     throw new Error('Unarchived managed current revision must not be labelled recovered');
    total+=bytes.byteLength;
    if(files.length>=LIMIT_FILES||total>LIMIT_TOTAL)
     throw new Error('Managed recovery exceeds size or file limit');
    const destinationFile=join(target,'managed',scriptId,name);
    await writeFile(destinationFile,bytes,{flag:'wx',mode:0o600});
    const saved=await readFile(destinationFile);
    if(hash(saved)!==digest)throw new Error('Written managed snapshot hash mismatch');
    files.push({path:'managed/'+scriptId+'/'+name,sha256:digest,bytes:bytes.byteLength});
   }
  }
 }
 const manifest={kind:'usshm-managed-recovery-v1',complete:true,files};
 await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{
  flag:'wx',mode:0o600
 });
 return {path:target,files:Object.freeze(files)};
}
