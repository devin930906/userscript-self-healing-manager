import {randomUUID} from 'node:crypto';
import {lstat,readdir,realpath} from 'node:fs/promises';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {basename,dirname,resolve} from 'node:path';
import {analyzeSource,type SourceAnalysis} from '../../source-analyzer/src/index.ts';
import type {ScriptRepository} from '../../persistence/src/index.ts';

/**
 * Only stable, known diagnostic codes may cross the import/scan boundary.
 * Node filesystem and SQLite exceptions can embed absolute account paths,
 * raw SQL, credentials, and arbitrary source strings in their messages.
 * Never forward an Error, stack or interpolated exception to renderer/IPC.
 */
const SAFE_IMPORT_CODES=new Set([
 'ENOENT','EACCES','EPERM','ENOTDIR','EISDIR','EMFILE','ENFILE','ENOSPC','EROFS','EBUSY',
 'SQLITE_BUSY','SQLITE_LOCKED','SQLITE_READONLY','SQLITE_FULL','SQLITE_IOERR',
 'SQLITE_CANTOPEN','SQLITE_CORRUPT','SQLITE_NOTADB',
]);
function safeImportDiagnostic(stage:string,error:unknown):string{
 try{
  const direct=error&&typeof error==='object'?
   (error as {code?:unknown}).code:undefined;
  if(typeof direct==='string'&&SAFE_IMPORT_CODES.has(direct))
   return stage+': '+direct;
  // Some SQLite implementations expose only an "SQLITE_CODE: private text"
  // message. Extract the fixed prefix, never include the remainder.
  if(error instanceof Error){
   const match=/^(SQLITE_[A-Z][A-Z0-9_]{0,32}):/.exec(error.message.slice(0,48));
   if(match&&SAFE_IMPORT_CODES.has(match[1]!))return stage+': '+match[1];
  }
 }catch{/* Untrusted exception object/getter; retain only the safe stage. */}
 return stage;
}

export interface EnumeratedScript {path:string;status:'found'|'unreadable'|'symlink-skipped'; message?:string|undefined}
export interface ImportResult {path:string;status:'imported'|'parse-error'|'duplicate-path'|'invalid-extension'|'unreadable'|'too-large'|'symlink-skipped';scriptId?:string|undefined;analysis?:SourceAnalysis|undefined;message?:string|undefined}
/**
 * Validate path components from the filesystem root downward. lstat() on a
 * leaf alone follows symlinks/junctions in its parent path. Stop at the
 * first linked component before reading anything below it.
 *
 * Node cannot pin every ancestor across concurrent directory renames, so this
 * is a best-effort boundary check, not a claim of race-free directory handles.
 */
async function containsLinkedComponent(input:string):Promise<boolean>{
 const components:string[]=[];
 for(let current=resolve(input);;){
  components.push(current);
  const parent=dirname(current);
  if(parent===current)break;
  current=parent;
 }
 for(const component of components.reverse()){
  if((await lstat(component)).isSymbolicLink())return true;
 }
 return false;
}

// Match the final userscript suffix only. Sharing this predicate between
// selected-file import and folder discovery prevents inconsistent filtering.
function isUserscriptPath(path:string):boolean{
 return path.toLowerCase().endsWith('.user.js');
}

// Both registry entrypoints accept runtime input, not trustworthy TypeScript
// arrays. for..of also visits sparse-array holes that Array.every skips.
function validPathSelection(paths:unknown):paths is string[]{
 if(!Array.isArray(paths))return false;
 for(const path of paths){
  if(typeof path!=='string'||path.trim().length===0)return false;
 }
 return true;
}

export async function enumerateScripts(request:{paths:string[];recursive:boolean;followSymlinks:false;maxEntries?:number}):Promise<EnumeratedScript[]>{
 if(!request||typeof request!=='object'||!validPathSelection(request.paths)||
    typeof request.recursive!=='boolean'||request.followSymlinks!==false)
  throw new Error('Invalid script enumeration request');
 const {paths,recursive,maxEntries=Number.MAX_SAFE_INTEGER}=request;
 if(!Number.isSafeInteger(maxEntries)||maxEntries<0)throw new Error('limit-exceeded');
 const output:EnumeratedScript[]=[];const visited=new Set<string>();
 // Abort during enumeration, not after reading/importing every script in a huge directory.
 function append(item:EnumeratedScript):void{
  if(output.length>=maxEntries)throw new Error('limit-exceeded');
  output.push(item);
 }
 async function walk(input:string):Promise<void>{
  const absolute=resolve(input);
  let info;
  try {
   if(await containsLinkedComponent(absolute)){append({path:absolute,status:'symlink-skipped'});return;}
   info=await lstat(absolute);
  }catch(error){append({path:absolute,status:'unreadable',message:safeImportDiagnostic('Source unreadable',error)});return;}
  if(info.isSymbolicLink()){append({path:absolute,status:'symlink-skipped'});return;}
  const key=await realpath(absolute).catch(()=>absolute);
  if(visited.has(key))return;visited.add(key);
  if(info.isDirectory()){
   let contents:string[];try{contents=await readdir(absolute);}catch(error){append({path:absolute,status:'unreadable',message:safeImportDiagnostic('Source unreadable',error)});return;}
   if(!recursive && paths.every(x=>resolve(x)!==absolute))return;
   for(const name of contents.sort()){
    const target=resolve(absolute,name);const stat=await lstat(target).catch(()=>null);
    if(stat?.isDirectory()&&!recursive)continue;
    await walk(target);
   }
  } else if(info.isFile() && isUserscriptPath(absolute))append({path:absolute,status:'found'});
 }
 for(const path of paths)await walk(path);
 return output;
}
export async function importPaths(request:{paths:string[];recursive:boolean;repository:ScriptRepository;maxFiles?:number}):Promise<ImportResult[]>{
 if(!request||typeof request!=='object'||!validPathSelection(request.paths)||
    typeof request.recursive!=='boolean')
  throw new Error('Invalid script import request');
 const {paths,recursive,repository,maxFiles=Number.MAX_SAFE_INTEGER}=request;
 if(!Number.isSafeInteger(maxFiles)||maxFiles<1||paths.length>maxFiles)throw new Error('limit-exceeded');
 const output:ImportResult[]=[];
 // Expand directories explicitly; direct file requests preserve invalid-extension feedback.
 const candidates:EnumeratedScript[]=[];
 for(const input of paths){
  const path=resolve(input);
  let info:Awaited<ReturnType<typeof lstat>>|null=null;
  let linked=false;
  let filesystemError:unknown;
  try{
   linked=await containsLinkedComponent(path);
   if(!linked)info=await lstat(path);
  }catch(error){filesystemError=error;}
  if(linked)candidates.push({path,status:'symlink-skipped'});
  else if(info?.isDirectory()){candidates.push(...await enumerateScripts({paths:[path],recursive,followSymlinks:false,maxEntries:maxFiles-candidates.length}));}
  else if(info?.isSymbolicLink())candidates.push({path,status:'symlink-skipped'});
  else candidates.push({path,status:info?'found':'unreadable',
   ...(filesystemError!==undefined?{message:safeImportDiagnostic('Source unreadable',filesystemError)}:{})});
  if(candidates.length>maxFiles)throw new Error('limit-exceeded');
 }
 // Every selected directory is expanded before any bytes are read or SQLite rows are written.
 const seen=new Set<string>();
 for(const entry of candidates){
  const path=entry.path;
  if(entry.status!=='found'){output.push({path,status:entry.status,message:entry.message});continue;}
  if(!isUserscriptPath(path)){output.push({path,status:'invalid-extension'});continue;}
  if(seen.has(path)){output.push({path,status:'duplicate-path'});continue;}seen.add(path);
  let data:Uint8Array;
  try{
   if(await containsLinkedComponent(path)){output.push({path,status:'symlink-skipped'});continue;}
   const info=await lstat(path);
   if(info.isSymbolicLink()){output.push({path,status:'symlink-skipped'});continue;}
   if(!info.isFile()){output.push({path,status:'unreadable',message:'Not a regular userscript file'});continue;}
   if(info.size>512*1024){output.push({path,status:'too-large'});continue;}
   // A selected file may change between enumeration and read. Pin the open
   // descriptor and enforce the size budget during I/O, not only at lstat.
   const exactInfo=await lstat(path,{bigint:true});
   data=await readPinnedRegularFile(path,{maxBytes:512*1024,expected:info,expectedNative:exactInfo});
   if(await containsLinkedComponent(path)){output.push({path,status:'symlink-skipped'});continue;}
  }catch(error){output.push({path,status:'unreadable',message:safeImportDiagnostic('Source unreadable',error)});continue;}
  let id:string;
  try{id=repository.findIdByPath(path)??randomUUID();}
  catch(error){
   // Preserve the stable ImportResult status contract used by scan-service.
   // The message distinguishes a registry failure from unreadable source data.
   output.push({path,status:'unreadable',message:safeImportDiagnostic('Registry lookup failed',error)});
   continue;
  }
  const analysis=analyzeSource({scriptId:id,sourceBytes:data});
  const status=analysis.parseDiagnostics.length?'parse-error':'imported';
  const now=new Date().toISOString();
  try{
   repository.upsert({id,path,displayName:basename(path),sha256:analysis.sourceSha256,healthStatus:status==='imported'?(analysis.selectorRecords.some(x=>x.runtimeRequired)?'runtime-required':'parsed'):'parse-error',metadataJson:JSON.stringify(analysis.metadata),createdAt:now,updatedAt:now});
  }catch(error){
   output.push({path,status:'unreadable',message:safeImportDiagnostic('Registry write failed',error)});
   continue;
  }
  output.push({path,status,scriptId:id,analysis,message:analysis.parseDiagnostics.join('; ')||undefined});
 }
 return output;
}
