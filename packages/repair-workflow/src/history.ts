import {createHash,randomUUID} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {readdir,readFile,lstat,writeFile,rename,unlink} from 'node:fs/promises';

export interface ManagedRevision {readonly hash:string;readonly kind:'original'|'revision';readonly fileName:string;readonly verified:true}
const hashBytes=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const validateInput=(managedRoot:string,scriptId:string)=>{
 if(!isAbsolute(managedRoot))throw new Error('Absolute managed root is required');
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(scriptId))throw new Error('Unsafe scriptId');
 return join(managedRoot,'managed',scriptId);
};
async function assertDirectory(path:string):Promise<void>{
 const info=await lstat(path);
 if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Unsafe managed directory: symlink or non-directory');
}
async function assertHierarchy(root:string,folder:string):Promise<void>{
 await assertDirectory(root);
 await assertDirectory(join(root,'managed'));
 await assertDirectory(folder);
}
async function verifiedArchive(folder:string,fileName:string,hash:string):Promise<Uint8Array>{
 const path=join(folder,fileName),info=await lstat(path);
 if(info.isSymbolicLink()||!info.isFile())throw new Error('Unsafe archive: symlink or non-regular file');
 if(info.size>512*1024)throw new Error('Archived revision is too large');
 const bytes=await readFile(path);
 if(hashBytes(bytes)!==hash)throw new Error('Archived revision hash mismatch or corruption');
 return bytes;
}
export async function listManagedRevisions({managedRoot,scriptId}:{managedRoot:string;scriptId:string}):Promise<ManagedRevision[]>{
 const folder=validateInput(managedRoot,scriptId);
 try{await assertHierarchy(managedRoot,folder);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
 const filenames=await readdir(folder);
 const revisions:ManagedRevision[]=[];
 for(const filename of filenames){
  const match=/^(original|revision)-([a-f0-9]{64})\.user\.js$/.exec(filename);
  if(!match)continue;
  await verifiedArchive(folder,filename,match[2]!);
  revisions.push({hash:match[2]!,kind:match[1] as 'original'|'revision',fileName:filename,verified:true});
 }
 return revisions.sort((a,b)=>a.kind.localeCompare(b.kind)||a.hash.localeCompare(b.hash));
}
export async function activateManagedRevision({managedRoot,scriptId,hash,approved}:{managedRoot:string;scriptId:string;hash:string;approved:boolean}):Promise<{hash:string;activePath:string}>{
 if(approved!==true)throw new Error('Explicit rollback approval required');
 const folder=validateInput(managedRoot,scriptId);
 if(!/^[0-9a-f]{64}$/.test(hash))throw new Error('Invalid SHA-256 hash');
 await assertHierarchy(managedRoot,folder);
 let bytes:Uint8Array|undefined;
 for(const kind of ['revision','original'] as const){
  try{bytes=await verifiedArchive(folder,kind+'-'+hash+'.user.js',hash);break;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 if(!bytes)throw new Error('Revision hash not found in managed archive');
 const activePath=join(folder,'current.user.js');
 // Fail closed: never silently discard edits made to current.user.js outside this manager.
 let existingInfo:Awaited<ReturnType<typeof lstat>>|undefined;
 try{existingInfo=await lstat(activePath);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(existingInfo){
  if(!existingInfo.isFile()||existingInfo.isSymbolicLink())throw new Error('Unsafe managed current file: symlink or non-regular file');
  if(existingInfo.size>512*1024)throw new Error('Managed current file is too large');
  const currentHash=hashBytes(await readFile(activePath));
  let isArchived=false;
  for(const kind of ['revision','original'] as const){
   try{await verifiedArchive(folder,kind+'-'+currentHash+'.user.js',currentHash);isArchived=true;break;}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  if(!isArchived)throw new Error('Managed current contains unmanaged external edits; preserve them before restoring');
 }
 const temporary=join(folder,'current-'+randomUUID()+'.tmp');
 try{
  await writeFile(temporary,bytes,{flag:'wx',mode:0o600});
  await rename(temporary,activePath);
 }catch(error){await unlink(temporary).catch(()=>{});throw error;}
 return {hash,activePath};
}
