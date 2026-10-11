import {randomUUID,createHash} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {applyManagedPatchBatch,proposeLiteralPatchBatch,type BatchLiteralPatchDraft,type BatchSelectorChange} from '../../patch-engine/src/index.ts';
import {analyzeSource} from '../../source-analyzer/src/index.ts';
import {activateManagedRevision,listManagedRevisions} from './history.ts';

const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
type Pending={scriptId:string;sourcePath:string;workingPath:string;originalHash:string;
 kind:'original'|'revision';draft:BatchLiteralPatchDraft;selectorIndexes:readonly number[]};
async function pinned(path:string){
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.size>512*1024)
  throw new Error('Unsafe managed batch source');
 return readPinnedRegularFile(path,{maxBytes:512*1024,expected:info});
}
/** Explicitly reviewed batch transaction; never changes original userscripts. */
export function createBatchRepairWorkflow({managedRoot}:{managedRoot:string}){
 if(typeof managedRoot!=='string'||!isAbsolute(managedRoot))
  throw new Error('Invalid batch managed root');
 const pending=new Map<string,Pending>(),applying=new Set<string>(),epochs=new Map<string,number>();
 let invalidation=0;
 const discardScript=(id:string)=>{
  for(const [key,record] of pending)if(record.scriptId===id)pending.delete(key);
 };
 return {
  discard(proposalId:string):boolean{return pending.delete(proposalId);},
  invalidatePending():void{pending.clear();invalidation++;},
  inspectPending(proposalId:string){
   const item=pending.get(proposalId);
   return item?Object.freeze({scriptId:item.scriptId,previousHash:item.draft.baseHash,
    proposedHash:item.draft.proposedHash,selectorIndexes:Object.freeze([...item.selectorIndexes])}):null;
  },
  async proposeBatch({sourcePath,scriptId,changes}:{
   sourcePath:string;scriptId:string;changes:readonly BatchSelectorChange[];
  }){
   if(typeof sourcePath!=='string'||!isAbsolute(sourcePath)||
      typeof scriptId!=='string'||!/^[a-z0-9_-]{1,64}$/i.test(scriptId))
    throw new Error('Invalid scanned batch script');
   if(!Array.isArray(changes)||changes.length<2||changes.length>8)
    throw new Error('Batch requires between 2 and 8 selectors');
   if(applying.has(scriptId))throw new Error('Batch revision in progress');
   const epoch=epochs.get(scriptId)??0,global=invalidation;
   const original=await pinned(sourcePath),originalHash=sha(original);
   const archives=await listManagedRevisions({managedRoot,scriptId});
   const current=join(managedRoot,'managed',scriptId,'current.user.js');
   const hasCurrent=await lstat(current).then(v=>v,(e:unknown)=>{
    if((e as NodeJS.ErrnoException).code==='ENOENT')return null;
    throw e;
   });
   let workingPath=sourcePath,working=original;
   let kind:'original'|'revision'='original';
   if(hasCurrent){
    if(!archives.some(v=>v.kind==='original'&&v.hash===originalHash))
     throw new Error('Original batch userscript has changed since archive');
    working=await pinned(current);
    const archive=archives.find(v=>v.hash===sha(working));
    if(!archive)throw new Error('Unverified edited managed current');
    workingPath=current;kind=archive.kind;
   }else if(archives.length)throw new Error('Missing managed current for batch revision');
   const initial=analyzeSource({scriptId,sourceBytes:original}).selectorRecords;
   const active=workingPath===sourcePath?initial:
    analyzeSource({scriptId,sourceBytes:working}).selectorRecords;
   if(initial.length!==active.length)throw new Error('Managed AST selector count changed');
   const selectorIndexes:number[]=[];
   const mapped=changes.map(change=>{
    if(!change?.selectorLocation)throw new Error('Missing pinned batch selector position');
    const i=initial.findIndex(r=>r.method===change.selectorLocation.method&&
     r.sourceRange.start.line===change.selectorLocation.line&&
     r.sourceRange.start.column===change.selectorLocation.column);
    const currentLocator=i>=0?active[i]:undefined;
    if(i>=0)selectorIndexes.push(i);
    if(!currentLocator||currentLocator.method!==change.selectorLocation.method||
       currentLocator.expression!==change.oldSelector||currentLocator.dynamicKind!=='literal')
     throw new Error('Batch selector mapping no longer matches scanned source');
    return {...change,selectorLocation:{
     method:currentLocator.method,line:currentLocator.sourceRange.start.line,
     column:currentLocator.sourceRange.start.column,
    }};
   });
   if(selectorIndexes.some(i=>i>=50)||new Set(selectorIndexes).size!==selectorIndexes.length)
    throw new Error('Batch V1 only supports unique scanned selector indexes 0..49');
   const draft=proposeLiteralPatchBatch({sourceBytes:working,changes:mapped});
   if(sha(await pinned(sourcePath))!==originalHash||
      (workingPath!==sourcePath&&sha(await pinned(workingPath))!==draft.baseHash))
    throw new Error('Original or managed source changed during batch review');
   if(applying.has(scriptId)||global!==invalidation||epoch!==(epochs.get(scriptId)??0))
    throw new Error('Batch preview became stale');
   if(pending.size>=64)throw new Error('Too many pending batch reviews');
   const proposalId=randomUUID();
   pending.set(proposalId,{scriptId,sourcePath,workingPath,originalHash,kind,draft,
    selectorIndexes:Object.freeze([...selectorIndexes].sort((a,b)=>a-b))});
   // The entire patch must be reviewable even when the affected selectors
   // are thousands of characters after the source header. Each row keeps its
   // original scanned AST identity; do not leak unrelated source text.
   const reviewedChanges=draft.changes.map((x,i)=>({
    selectorIndex:selectorIndexes[i]!,
    method:changes[i]!.selectorLocation.method,
    line:changes[i]!.selectorLocation.line,
    column:changes[i]!.selectorLocation.column,
    oldSelector:x.oldSelector,newSelector:x.newSelector,
   }));
   const preview=reviewedChanges.map(change=>
    '行 '+change.line+' · 列 '+change.column+' · #'+(change.selectorIndex+1)+
    ' · '+change.method+' '+JSON.stringify(change.oldSelector)+
    ' → '+JSON.stringify(change.newSelector)).join('\n');
   return {proposalId,scriptId,originalHash,baseHash:draft.baseHash,
    proposedHash:draft.proposedHash,
    changes:reviewedChanges,preview};
  },
  async restore({scriptId,hash,approved,expectedCurrentHash}:{
   scriptId:string;hash:string;approved:boolean;expectedCurrentHash:string;
  }):Promise<{hash:string;activePath:string}>{
   if(approved!==true||typeof scriptId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(scriptId)||
      typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)||
      typeof expectedCurrentHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedCurrentHash))
    throw new Error('Invalid approved batch rollback identity');
   if(applying.has(scriptId))throw new Error('Another managed batch operation in progress');
   applying.add(scriptId);
   try{
    const restored=await activateManagedRevision({
     managedRoot,scriptId,hash,approved:true,expectedCurrentHash,
    });
    epochs.set(scriptId,(epochs.get(scriptId)??0)+1);
    discardScript(scriptId);
    return restored;
   }finally{applying.delete(scriptId);}
  },
  async applyBatch({proposalId,approved}:{proposalId:string;approved:boolean}){
   if(approved!==true)throw new Error('Explicit batch approval required');
   if(typeof proposalId!=='string'||!/^[0-9a-f-]{36}$/i.test(proposalId))
    throw new Error('Invalid batch proposal');
   const staged=pending.get(proposalId);
   if(!staged)throw new Error('Batch proposal not found or stale');
   if(applying.has(staged.scriptId))throw new Error('Concurrent batch activation');
   applying.add(staged.scriptId);pending.delete(proposalId);
   try{
    if(sha(await pinned(staged.sourcePath))!==staged.originalHash)
     throw new Error('Original userscript hash mismatch after batch review');
    if(staged.workingPath===staged.sourcePath){
     const current=join(managedRoot,'managed',staged.scriptId,'current.user.js');
     const present=await lstat(current).then(()=>true,(e:unknown)=>{
      if((e as NodeJS.ErrnoException).code==='ENOENT')return false;
      throw e;
     });
     if(present||(await listManagedRevisions({managedRoot,scriptId:staged.scriptId})).length)
      throw new Error('Stale batch proposal: active revision already exists');
    }
    const archived=await applyManagedPatchBatch({
     sourcePath:staged.workingPath,managedRoot,scriptId:staged.scriptId,
     draft:staged.draft,expectedHash:staged.draft.baseHash,approved:true,
     baseRevisionKind:staged.kind,
    });
    await activateManagedRevision({managedRoot,scriptId:staged.scriptId,
     hash:archived.hash,approved:true,
     expectedCurrentHash:staged.workingPath===staged.sourcePath?null:staged.draft.baseHash});
    epochs.set(staged.scriptId,(epochs.get(staged.scriptId)??0)+1);
    discardScript(staged.scriptId);
    return archived;
   }finally{applying.delete(staged.scriptId);}
  },
 };
}
