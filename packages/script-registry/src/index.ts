import {randomUUID} from 'node:crypto';
import {lstat,readdir,readFile,realpath} from 'node:fs/promises';
import {extname,basename,resolve} from 'node:path';
import {analyzeSource,type SourceAnalysis} from '../../source-analyzer/src/index.ts';
import type {ScriptRepository} from '../../persistence/src/index.ts';

export interface EnumeratedScript {path:string;status:'found'|'unreadable'|'symlink-skipped'; message?:string|undefined}
export interface ImportResult {path:string;status:'imported'|'parse-error'|'duplicate-path'|'invalid-extension'|'unreadable'|'too-large'|'symlink-skipped';scriptId?:string|undefined;analysis?:SourceAnalysis|undefined;message?:string|undefined}
export async function enumerateScripts({paths,recursive,followSymlinks}:{paths:string[];recursive:boolean;followSymlinks:false}):Promise<EnumeratedScript[]>{
 const output:EnumeratedScript[]=[];const visited=new Set<string>();
 async function walk(input:string):Promise<void>{
  const absolute=resolve(input);
  let info;
  try {info=await lstat(absolute);}catch(error){output.push({path:absolute,status:'unreadable',message:String(error)});return;}
  if(info.isSymbolicLink()){output.push({path:absolute,status:'symlink-skipped'});return;}
  const key=await realpath(absolute).catch(()=>absolute);
  if(visited.has(key))return;visited.add(key);
  if(info.isDirectory()){
   let contents:string[];try{contents=await readdir(absolute);}catch(error){output.push({path:absolute,status:'unreadable',message:String(error)});return;}
   if(!recursive && paths.every(x=>resolve(x)!==absolute))return;
   for(const name of contents.sort()){
    const target=resolve(absolute,name);const stat=await lstat(target).catch(()=>null);
    if(stat?.isDirectory()&&!recursive)continue;
    await walk(target);
   }
  } else if(info.isFile() && absolute.endsWith('.user.js'))output.push({path:absolute,status:'found'});
 }
 for(const path of paths)await walk(path);
 return output;
}
export async function importPaths({paths,recursive,repository}:{paths:string[];recursive:boolean;repository:ScriptRepository}):Promise<ImportResult[]>{
 const output:ImportResult[]=[];
 // Expand directories explicitly; direct file requests preserve invalid-extension feedback.
 const candidates:EnumeratedScript[]=[];
 for(const input of paths){
  const path=resolve(input);const info=await lstat(path).catch(()=>null);
  if(info?.isDirectory()){candidates.push(...await enumerateScripts({paths:[path],recursive,followSymlinks:false}));}
  else if(info?.isSymbolicLink())candidates.push({path,status:'symlink-skipped'});
  else candidates.push({path,status:info?'found':'unreadable'});
 }
 const seen=new Set<string>();
 for(const entry of candidates){
  const path=entry.path;
  if(entry.status!=='found'){output.push({path,status:entry.status,message:entry.message});continue;}
  if(!path.toLowerCase().endsWith('.user.js')){output.push({path,status:'invalid-extension'});continue;}
  if(seen.has(path)){output.push({path,status:'duplicate-path'});continue;}seen.add(path);
  let data:Uint8Array;
  try{const info=await lstat(path);if(info.size>512*1024){output.push({path,status:'too-large'});continue;}data=await readFile(path);}catch(error){output.push({path,status:'unreadable',message:String(error)});continue;}
  const id=repository.findIdByPath(path)??randomUUID();
  const analysis=analyzeSource({scriptId:id,sourceBytes:data});
  const status=analysis.parseDiagnostics.length?'parse-error':'imported';
  const now=new Date().toISOString();
  repository.upsert({id,path,displayName:basename(path),sha256:analysis.sourceSha256,healthStatus:status==='imported'?(analysis.selectorRecords.some(x=>x.runtimeRequired)?'runtime-required':'parsed'):'parse-error',metadataJson:JSON.stringify(analysis.metadata),createdAt:now,updatedAt:now});
  output.push({path,status,scriptId:id,analysis,message:analysis.parseDiagnostics.join('; ')||undefined});
 }
 return output;
}
