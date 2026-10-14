import {randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,rename,rmdir,unlink,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {assertUnlinkedRecoveryDirectory} from '../../runtime-paths/src/recovery-directory.ts';
import {checkUserscriptPageScope,type UserscriptPageMetadata} from './page-scope.ts';

const NAME='site-test-cases.json';
const MAX_BYTES=131072;
const MAX_ITEMS=256;
const MAX_PER_SCRIPT=16;
const SCRIPT_ID=/^[A-Za-z0-9_-]{1,128}$/;
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type DeclaredPageState='logged-out'|'logged-in'|'custom';
export interface SiteTestCase{
 readonly id:string;readonly scriptId:string;readonly label:string;
 readonly url:string;readonly stateId:DeclaredPageState;
}
type Saved={readonly schemaVersion:1;readonly cases:SiteTestCase[]};
const empty=():Saved=>({schemaVersion:1,cases:[]});
const filename=(dataRoot:string)=>{
 if(typeof dataRoot!=='string'||!isAbsolute(dataRoot))
  throw new Error('Absolute application Data directory required');
 return join(dataRoot,NAME);
};
function scriptIdentity(value:unknown):asserts value is string{
 if(typeof value!=='string'||!SCRIPT_ID.test(value))
  throw new Error('Invalid site test script identity');
}
function caseIdentity(value:unknown):asserts value is string{
 if(typeof value!=='string'||!ID.test(value))
  throw new Error('Invalid site test case identity');
}
function labelOf(value:unknown):string{
 if(typeof value!=='string')throw new Error('Invalid test scenario label');
 const text=value.trim();
 if(text.length<1||text.length>60||text==='.'||text==='..'||
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/u.test(text))
  throw new Error('Invalid test scenario label');
 return text;
}
function stateOf(value:unknown):DeclaredPageState{
 if(value!=='logged-in'&&value!=='logged-out'&&value!=='custom')
  throw new Error('Invalid declared page state');
 return value;
}
/** Only an explicitly entered public URL; never save tokens, passwords or fragments.
 * Saving a scenario NEVER navigates Chrome or authenticates a login state. */
function exactPageUrl(value:unknown):string{
 if(typeof value!=='string'||value.length<1||value.length>2048||
    /[\u0000-\u0020\u007f]/.test(value))
  throw new Error('Unsafe test page URL or size budget');
 let parsed:URL;
 try{parsed=new URL(value);}catch{throw new Error('Unsafe test page URL');}
 if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||
    parsed.username||parsed.password||parsed.search||parsed.hash||
    parsed.href.length>2048)
  throw new Error('Unsafe test page URL: credentials, query and fragment not allowed');
 return parsed.href;
}
function validateState(value:unknown):Saved{
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw new Error('Corrupt site test case registry');
 const object=value as Record<string,unknown>;
 if(Object.keys(object).sort().join(',')!=='cases,schemaVersion'||
    object.schemaVersion!==1||!Array.isArray(object.cases)||
    object.cases.length>MAX_ITEMS)
  throw new Error('Corrupt site test case registry');
 const cases:SiteTestCase[]=[];
 const ids=new Set<string>(),pairs=new Set<string>();
 const perScript=new Map<string,number>();
 for(const item of object.cases){
  if(!item||typeof item!=='object'||Array.isArray(item)||
     Object.keys(item).sort().join(',')!=='id,label,scriptId,stateId,url')
   throw new Error('Corrupt site test case record');
  const row=item as Record<string,unknown>;
  caseIdentity(row.id);scriptIdentity(row.scriptId);
  const label=labelOf(row.label),stateId=stateOf(row.stateId),url=exactPageUrl(row.url);
  if(label!==row.label||url!==row.url||ids.has(row.id)||
     pairs.has(JSON.stringify([row.scriptId,url,stateId])))
   throw new Error('Corrupt duplicate or unnormalized site test case');
  ids.add(row.id);pairs.add(JSON.stringify([row.scriptId,url,stateId]));
  perScript.set(row.scriptId,(perScript.get(row.scriptId)??0)+1);
  if(perScript.get(row.scriptId)!>MAX_PER_SCRIPT)
   throw new Error('Corrupt site test case registry count');
  cases.push({id:row.id,scriptId:row.scriptId,label,url,stateId});
 }
 return {schemaVersion:1,cases};
}
/** Closed, bounded snapshot schema gate for *non-active* core recovery.
 * Never imports scripts or silently repairs an invalid stored configuration. */
export function assertSiteTestCaseRegistryBytes(bytes:Uint8Array):void{
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>MAX_BYTES)
  throw new Error('Invalid site test case recovery size');
 try{
  validateState(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 }catch{throw new Error('Invalid site test case recovery registry');}
}
async function readState(dataRoot:string):Promise<Saved>{
 const path=filename(dataRoot);
 await assertUnlinkedRecoveryDirectory(dataRoot);
 let info:Awaited<ReturnType<typeof lstat>>;
 try{info=await lstat(path);}
 catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')return empty();
  throw error;
 }
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
    info.size<1||info.size>MAX_BYTES)
  throw new Error('Unsafe or oversized site test case registry');
 try{
  const buffer=await readPinnedRegularFile(path,{
   maxBytes:MAX_BYTES,expected:info,expectedNative:await lstat(path,{bigint:true}),
  });
  return validateState(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)));
 }catch{throw new Error('Corrupt or invalid site test case registry; preserve it for review');}
}
/** Exclusive app-owned lease: a crashed/other writer is not silently bypassed. */
async function writeLocked<T>(dataRoot:string,operation:()=>Promise<T>):Promise<T>{
 const lock=filename(dataRoot)+'.write-lock';
 await assertUnlinkedRecoveryDirectory(dataRoot);
 try{await mkdir(lock,{mode:0o700});}
 catch(error){
  if((error as NodeJS.ErrnoException).code==='EEXIST')
   throw new Error('Site test case registry is write-locked; preserve existing data');
  throw error;
 }
 try{return await operation();}finally{await rmdir(lock);}
}
async function persist(dataRoot:string,state:Saved):Promise<void>{
 const target=filename(dataRoot);
 const content=JSON.stringify(state)+'\n';
 if(Buffer.byteLength(content,'utf8')>MAX_BYTES)
  throw new Error('Site test case registry exceeds byte budget');
 const temp=join(dataRoot,'.site-test-cases-'+randomUUID()+'.tmp');
 try{
  await writeFile(temp,content,{flag:'wx',mode:0o600});
  // Never overwrite a registry that changed or became a symlink after read.
  await readState(dataRoot);
  await rename(temp,target);
 }finally{
  await unlink(temp).catch(error=>{
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  });
 }
}
export async function listSiteTestCases({dataRoot,scriptId}:{
 dataRoot:string;scriptId:string;
}):Promise<SiteTestCase[]>{
 scriptIdentity(scriptId);
 return (await readState(dataRoot)).cases.filter(c=>c.scriptId===scriptId);
}
export async function createSiteTestCase({dataRoot,scriptId,url,label,stateId,metadata}:{
 dataRoot:string;scriptId:string;url:string;label:string;
 stateId:DeclaredPageState;metadata:UserscriptPageMetadata;
}):Promise<SiteTestCase>{
 scriptIdentity(scriptId);
 const safeUrl=exactPageUrl(url),safeLabel=labelOf(label),safeState=stateOf(stateId);
 if(checkUserscriptPageScope(metadata,safeUrl).status!=='allowed')
  throw new Error('Site test page is outside confirmed userscript activation scope');
 return writeLocked(dataRoot,async()=>{
  const state=await readState(dataRoot);
  if(state.cases.length>=MAX_ITEMS||
     state.cases.filter(c=>c.scriptId===scriptId).length>=MAX_PER_SCRIPT)
   throw new Error('Site test case count limit exceeded');
  if(state.cases.some(c=>c.scriptId===scriptId&&c.url===safeUrl&&c.stateId===safeState))
   throw new Error('Site test case already exists');
  const entry:SiteTestCase={id:randomUUID(),scriptId,label:safeLabel,url:safeUrl,stateId:safeState};
  await persist(dataRoot,{schemaVersion:1,cases:[...state.cases,entry]});
  return entry;
 });
}
export async function removeSiteTestCase({dataRoot,scriptId,caseId,approved}:{
 dataRoot:string;scriptId:string;caseId:string;approved:boolean;
}):Promise<void>{
 if(approved!==true)throw new Error('Explicit site test case removal approval required');
 scriptIdentity(scriptId);caseIdentity(caseId);
 return writeLocked(dataRoot,async()=>{
  const state=await readState(dataRoot);
  const remaining=state.cases.filter(c=>!(c.scriptId===scriptId&&c.id===caseId));
  if(remaining.length===state.cases.length)throw new Error('Site test case not found');
  await persist(dataRoot,{schemaVersion:1,cases:remaining});
 });
}
export type SiteTestSelection={
 readonly status:'matched'|'mismatch'|'scope-blocked';
 readonly validationLevel:'configured-page-only';
 readonly pageStateVerified:false;
 readonly V2:'blocked';readonly V3:'not-configured';readonly V4:'not-configured';
 readonly functionalVerified:false;
};
/** A saved URL and user-declared login state are *configuration*, not CDP
 * identity, an observed login state or userscript business verification. */
export function verifySiteTestCaseSelection({entry,selectedUrl,metadata}:{
 entry:SiteTestCase;selectedUrl:string;metadata:UserscriptPageMetadata;
}):SiteTestSelection{
 const result=(status:SiteTestSelection['status']):SiteTestSelection=>
  Object.freeze({status,validationLevel:'configured-page-only' as const,
   pageStateVerified:false as const,V2:'blocked' as const,
   V3:'not-configured' as const,V4:'not-configured' as const,
   functionalVerified:false as const});
 if(!entry||typeof entry!=='object'||typeof entry.id!=='string'||
    typeof entry.scriptId!=='string')return result('scope-blocked');
 let stored:string;
 try{stored=exactPageUrl(entry.url);}catch{return result('scope-blocked');}
 if(checkUserscriptPageScope(metadata,stored).status!=='allowed')
  return result('scope-blocked');
 let current:string;
 try{current=exactPageUrl(selectedUrl);}catch{return result('mismatch');}
 return result(stored===current?'matched':'mismatch');
}
