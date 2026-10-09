import {createHash,randomUUID} from 'node:crypto';
import {lstat,open,readFile,readdir,unlink} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {ensureWritableDataRoot} from '../../runtime-paths/src/index.ts';
import {parseSiteAdapter,type SiteAdapter} from './site-adapter.ts';

/**
 * Persist *new* locally reviewed SiteAdapter definitions only. Existing site
 * versions cannot be overwritten until complete pinned-script dependency
 * discovery and regression gating are implemented.
 */
const MAX_BYTES=65_536;
const MAX_LIBRARY=200;
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
type Preview={
 readonly previewId:string;readonly siteId:string;readonly version:string;
 readonly stateCount:number;readonly roleCount:number;readonly urlPatterns:readonly string[];
 readonly sourceHash:string;
};
export type AdapterLibraryEntry={
 readonly siteId:string;readonly version:string;readonly stateCount:number;
 readonly roleCount:number;readonly urlPatterns:readonly string[];
 readonly sha256:string;readonly validationLevel:'definition-only';
};
interface Pending{
 readonly sourcePath:string;readonly sourceHash:string;readonly adapter:SiteAdapter;
}

function validPath(path:string,description:string){
 if(typeof path!=='string'||!isAbsolute(path))throw new Error(description+' must be absolute');
}
async function regularBounded(path:string):Promise<Uint8Array>{
 validPath(path,'Adapter path');
 const stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Site adapter must be a regular non-symlink file');
 if(stat.size<1||stat.size>MAX_BYTES)throw new Error('Site adapter JSON exceeds the safe size limit');
 const data=await readFile(path);
 if(data.byteLength<1||data.byteLength>MAX_BYTES)
  throw new Error('Site adapter JSON exceeds the safe size limit');
 const after=await lstat(path);
 if(!after.isFile()||after.isSymbolicLink()||after.size!==data.byteLength||
    after.ino!==stat.ino||after.dev!==stat.dev)
  throw new Error('Site adapter file identity changed while reading');
 return data;
}
function decodeAdapter(bytes:Uint8Array):SiteAdapter{
 let content:string;
 try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{throw new Error('Invalid SiteAdapter UTF-8 encoding');}
 let parsed:unknown;
 try{parsed=JSON.parse(content);}
 catch{throw new Error('Invalid SiteAdapter JSON syntax');}
 return parseSiteAdapter(parsed);
}
function summary(adapter:SiteAdapter,hash:string):AdapterLibraryEntry{
 return {
  siteId:adapter.siteId,version:adapter.version,
  stateCount:Object.keys(adapter.states).length,roleCount:Object.keys(adapter.roles).length,
  urlPatterns:[...adapter.urlPatterns],sha256:hash,validationLevel:'definition-only',
 };
}
async function doesExist(file:string):Promise<boolean>{
 try{
  await lstat(file);
  return true;
 }catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')return false;
  throw error;
 }
}
export function createSiteAdapterLibrary({dataRoot}:{dataRoot:string}){
 validPath(dataRoot,'Site adapter data root');
 const dir=join(dataRoot,'site-adapters');
 const pending=new Map<string,Pending>();
 const pathOf=(siteId:string)=>join(dir,siteId+'.json');
 const prepareDirectory=async()=>ensureWritableDataRoot(dir);
 return {
  async previewImport({sourcePath}:{sourcePath:string}):Promise<Preview>{
   if(pending.size>=10)throw new Error('Too many pending SiteAdapter previews');
   const bytes=await regularBounded(sourcePath);
   const adapter=decodeAdapter(bytes);
   await prepareDirectory();
   if(await doesExist(pathOf(adapter.siteId)))
    throw new Error('SiteAdapter already exists: upgrades require full pinned dependency impact review');
   const filenames=await readdir(dir);
   if(filenames.filter(x=>x.endsWith('.json')).length>=MAX_LIBRARY)
    throw new Error('SiteAdapter library size limit exceeded');
   const previewId=randomUUID(),sourceHash=sha(bytes);
   pending.set(previewId,{sourcePath,sourceHash,adapter});
   return {
    previewId,siteId:adapter.siteId,version:adapter.version,
    stateCount:Object.keys(adapter.states).length,roleCount:Object.keys(adapter.roles).length,
    urlPatterns:[...adapter.urlPatterns],sourceHash,
   };
  },
  async approveImport({previewId,approved}:{previewId:string;approved:boolean}):Promise<AdapterLibraryEntry>{
   if(approved!==true)throw new Error('Explicit SiteAdapter import approval required');
   if(typeof previewId!=='string'||!/^[0-9a-f-]{36}$/i.test(previewId))
    throw new Error('Invalid SiteAdapter preview ID');
   const staged=pending.get(previewId);
   if(!staged)throw new Error('SiteAdapter preview expired or not found');
   // Consume before any await: concurrent clicks cannot both apply a preview.
   pending.delete(previewId);
   const current=await regularBounded(staged.sourcePath);
   if(sha(current)!==staged.sourceHash)throw new Error('SiteAdapter source changed since preview; import cancelled');
   // Reparse so the canonical stored object derives from the exact approved bytes.
   const adapter=decodeAdapter(current);
   if(JSON.stringify(adapter)!==JSON.stringify(staged.adapter))
    throw new Error('SiteAdapter content changed since preview');
   await prepareDirectory();
   const dst=pathOf(adapter.siteId);
   const bytes=Buffer.from(JSON.stringify(adapter)+'\n','utf8');
   if(bytes.byteLength>MAX_BYTES)throw new Error('Normalized SiteAdapter exceeds safe size limit');
   let owned=false;
   try{
    const handle=await open(dst,'wx',0o600);
    owned=true;
    try{await handle.writeFile(bytes);await handle.sync();}
    finally{await handle.close();}
   }catch(error){
    if(owned)await unlink(dst).catch(()=>{});
    if((error as NodeJS.ErrnoException).code==='EEXIST')
     throw new Error('SiteAdapter already exists: upgrades cannot overwrite a pinned definition');
    throw error;
   }
   return summary(adapter,sha(bytes));
  },
  async list():Promise<AdapterLibraryEntry[]>{
   await prepareDirectory();
   const filenames=(await readdir(dir)).filter(name=>name.endsWith('.json')).sort();
   if(filenames.length>MAX_LIBRARY)throw new Error('SiteAdapter library exceeds safe count');
   const result:AdapterLibraryEntry[]=[];
   for(const filename of filenames){
    if(!/^[a-z][a-z0-9-]{0,63}\.json$/.test(filename))
     throw new Error('Unsafe stored SiteAdapter filename');
    const bytes=await regularBounded(join(dir,filename));
    const adapter=decodeAdapter(bytes);
    if(filename!==adapter.siteId+'.json')throw new Error('Stored SiteAdapter filename does not match site ID');
    result.push(summary(adapter,sha(bytes)));
   }
   return result;
  },
  discardPreview({previewId}:{previewId:string}):boolean{
   if(typeof previewId!=='string'||!/^[0-9a-f-]{36}$/i.test(previewId))
    throw new Error('Invalid SiteAdapter preview ID');
   return pending.delete(previewId);
  },
  invalidatePending():void{pending.clear();},
 };
}
