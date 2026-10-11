import {randomUUID} from 'node:crypto';
import {lstat,rename,writeFile,unlink,mkdir,rmdir} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';

const SETTINGS_NAME='browser-profiles.json';
const MAX_BYTES=32768;
const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const TITLE=/^[^\u0000-\u001f\u007f]{1,40}$/u;

export interface BrowserProfile {
 readonly id:string;
 readonly name:string;
 readonly executablePath:string;
 readonly isDefault:boolean;
}
interface SavedEntry {id:string;name:string;executablePath:string}
interface SavedState {schemaVersion:1;profiles:SavedEntry[];defaultId:string|null}
const empty=():SavedState=>({schemaVersion:1,profiles:[],defaultId:null});

function rootPath(dataRoot:string):string{
 if(typeof dataRoot!=='string'||!isAbsolute(dataRoot))
  throw new Error('Absolute application data root required');
 return join(dataRoot,SETTINGS_NAME);
}
function validateId(id:string):void{
 if(typeof id!=='string'||!ID.test(id))
  throw new Error('Invalid browser profile id');
}
function normalizeName(name:string):string{
 if(typeof name!=='string')throw new Error('Invalid browser profile name');
 const clean=name.trim();
 if(!TITLE.test(clean)||clean==='.'||clean==='..')
  throw new Error('Invalid browser profile name');
 return clean;
}
async function assertChromeExecutable(path:string):Promise<void>{
 if(typeof path!=='string'||!isAbsolute(path))
  throw new Error('Chrome executable path must be absolute');
 if(!/\.exe$/i.test(path))throw new Error('Chrome executable must be an EXE');
 let item:Awaited<ReturnType<typeof lstat>>;
 try{item=await lstat(path);}
 catch{throw new Error('Chrome executable is unavailable or missing');}
 if(!item.isFile()||item.isSymbolicLink())
  throw new Error('Unsafe Chrome executable: expected a regular file, not a symlink');
}
function validateState(raw:unknown):SavedState{
 if(!raw||typeof raw!=='object')throw new Error('Invalid browser profile registry');
 const p=raw as Record<string,unknown>;
 if(p.schemaVersion!==1||!Array.isArray(p.profiles)||p.profiles.length>16||
    !(p.defaultId===null||typeof p.defaultId==='string'))
  throw new Error('Invalid browser profile registry schema');
 const entries:SavedEntry[]=[];
 const ids=new Set<string>();
 const names=new Set<string>();
 for(const entry of p.profiles){
  if(!entry||typeof entry!=='object')throw new Error('Invalid browser profile record');
  const v=entry as Record<string,unknown>;
  validateId(v.id as string);
  const name=normalizeName(v.name as string);
  if(v.name!==name||typeof v.executablePath!=='string'||!isAbsolute(v.executablePath)||
     !/\.exe$/i.test(v.executablePath)||ids.has(v.id as string)||
     names.has(name.toLocaleLowerCase()))
   throw new Error('Invalid browser profile registry content');
  ids.add(v.id as string);
  names.add(name.toLocaleLowerCase());
  entries.push({id:v.id as string,name,executablePath:v.executablePath});
 }
 if((entries.length===0&&p.defaultId!==null)||
    (entries.length>0&&(!p.defaultId||!ids.has(p.defaultId as string))))
  throw new Error('Invalid default browser profile');
 return {schemaVersion:1,profiles:entries,defaultId:p.defaultId as string|null};
}
async function readState(dataRoot:string):Promise<SavedState>{
 const path=rootPath(dataRoot);
 let info:Awaited<ReturnType<typeof lstat>>;
 try{info=await lstat(path);}
 catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')return empty();
  throw error;
 }
 if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_BYTES)
  throw new Error('Unsafe or oversized browser profile registry');
 const raw=await readPinnedRegularFile(path,{maxBytes:MAX_BYTES,expected:info});
 try{return validateState(JSON.parse(raw.toString('utf8')));}
 catch{throw new Error('Corrupt or invalid browser profile registry; preserve it for recovery');}
}
/** Serialize read-modify-write across application processes. Never steal orphaned locks. */
async function withRegistryWriteLease<T>(dataRoot:string,fn:()=>Promise<T>):Promise<T>{
 const lock=rootPath(dataRoot)+'.write-lock';
 try{await mkdir(lock,{mode:0o700});}
 catch(error){
  if((error as NodeJS.ErrnoException).code==='EEXIST')
   throw new Error('Another browser profile registry writer holds the lock');
  throw error;
 }
 try{return await fn();}
 finally{await rmdir(lock);}
}
async function persist(dataRoot:string,state:SavedState):Promise<void>{
 const target=rootPath(dataRoot);
 // Do not repair or overwrite corrupted data silently. No browser is
 // automatically launched while reading or writing this optional registry.
 await readState(dataRoot);
 const temp=join(dataRoot,'.browser-profiles-'+randomUUID()+'.tmp');
 try{
  const payload=JSON.stringify(state)+'\n';
  if(Buffer.byteLength(payload,'utf8')>MAX_BYTES)
   throw new Error('Browser profile registry byte budget exceeded');
  await writeFile(temp,payload,{flag:'wx',mode:0o600});
  // A last-minute symlink/reparse point at the target must never be
  // implicitly followed. Single-instance Electron serializes UI writes.
  await readState(dataRoot);
  await rename(temp,target);
 }finally{
  await unlink(temp).catch(error=>{
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  });
 }
}
function present(state:SavedState):BrowserProfile[]{
 return state.profiles.map(item=>({...item,isDefault:item.id===state.defaultId}));
}
export interface BrowserProfileRegistryHealth {
 readonly status:'empty'|'ready'|'write-locked'|'invalid';
 readonly count:number|null;
}
/** Read-only registry health: never conceal a corrupt config as an empty list
 * and never delete locks possibly belonging to a running application. */
export async function inspectBrowserProfileRegistry({dataRoot}:{
 dataRoot:string;
}):Promise<BrowserProfileRegistryHealth>{
 const config=rootPath(dataRoot);
 try{
  const lock=await lstat(config+'.write-lock');
  return {status:lock.isDirectory()&&!lock.isSymbolicLink()?'write-locked':'invalid',count:null};
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')
   return {status:'invalid',count:null};
 }
 try{
  const configStat=await lstat(config);
  if(!configStat.isFile()||configStat.isSymbolicLink())
   return {status:'invalid',count:null};
 }catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')
   return {status:'empty',count:0};
  return {status:'invalid',count:null};
 }
 try{
  const profiles=(await readState(dataRoot)).profiles;
  return {status:profiles.length>0?'ready':'empty',count:profiles.length};
 }catch{return {status:'invalid',count:null};}
}
/** List settings only. A missing Chrome EXE remains visible, but will never be launched. */
export async function listBrowserProfiles({dataRoot}:{dataRoot:string}):Promise<BrowserProfile[]>{
 try{return present(await readState(dataRoot));}
 catch{return [];}
}
export async function createBrowserProfile({dataRoot,name,executablePath}:{
 dataRoot:string;name:string;executablePath:string;
}):Promise<BrowserProfile>{
 return withRegistryWriteLease(dataRoot,async()=>{
 const title=normalizeName(name);
 await assertChromeExecutable(executablePath);
 const state=await readState(dataRoot);
 if(state.profiles.length>=16)throw new Error('Browser profile count limit exceeded');
 if(state.profiles.some(x=>x.name.toLocaleLowerCase()===title.toLocaleLowerCase()))
  throw new Error('Browser profile name already exists');
 const entry:SavedEntry={id:randomUUID(),name:title,executablePath};
 const changed:SavedState={schemaVersion:1,profiles:[...state.profiles,entry],
  defaultId:state.defaultId??entry.id};
 await persist(dataRoot,changed);
 return {...entry,isDefault:changed.defaultId===entry.id};
 });
}

export async function renameBrowserProfile({dataRoot,profileId,name}:{
 dataRoot:string;profileId:string;name:string;
}):Promise<BrowserProfile>{
 return withRegistryWriteLease(dataRoot,async()=>{
 validateId(profileId);const title=normalizeName(name);
 const state=await readState(dataRoot);
 const found=state.profiles.find(x=>x.id===profileId);
 if(!found)throw new Error('Browser profile not found');
 if(state.profiles.some(x=>x.id!==profileId&&x.name.toLocaleLowerCase()===title.toLocaleLowerCase()))
  throw new Error('Browser profile name already exists');
 const changed={...state,profiles:state.profiles.map(x=>x.id===profileId?{...x,name:title}:x)};
 await persist(dataRoot,changed);
 return {...found,name:title,isDefault:state.defaultId===profileId};
 });
}

export async function setDefaultBrowserProfile({dataRoot,profileId}:{
 dataRoot:string;profileId:string;
}):Promise<BrowserProfile>{
 return withRegistryWriteLease(dataRoot,async()=>{
 validateId(profileId);
 const state=await readState(dataRoot);
 const found=state.profiles.find(x=>x.id===profileId);
 if(!found)throw new Error('Browser profile not found');
 await persist(dataRoot,{...state,defaultId:profileId});
 return {...found,isDefault:true};
 });
}

/** Remove only a saved registry record. Never remove a Chrome EXE or profile directory. */
export async function removeBrowserProfile({dataRoot,profileId,approved}:{
 dataRoot:string;profileId:string;approved:boolean;
}):Promise<void>{
 return withRegistryWriteLease(dataRoot,async()=>{
 if(approved!==true)throw new Error('Explicit browser profile removal approval required');
 validateId(profileId);
 const state=await readState(dataRoot);
 if(!state.profiles.some(x=>x.id===profileId))throw new Error('Browser profile not found');
 const remaining=state.profiles.filter(x=>x.id!==profileId);
 const defaultId=state.defaultId===profileId?(remaining[0]?.id??null):state.defaultId;
 await persist(dataRoot,{...state,profiles:remaining,defaultId});
 });
}

/** Caller must explicitly select this profile; never load external profile dirs. */
export async function resolveBrowserProfileForLaunch({dataRoot,profileId}:{
 dataRoot:string;profileId:string;
}):Promise<{executablePath:string;isolatedProfileDir:string}>{
 validateId(profileId);
 const state=await readState(dataRoot);
 const selected=state.profiles.find(x=>x.id===profileId);
 if(!selected)throw new Error('Browser profile not found');
 await assertChromeExecutable(selected.executablePath);
 return {
  executablePath:selected.executablePath,
  isolatedProfileDir:join(dataRoot,'Chrome-Profiles',selected.id),
 };
}
