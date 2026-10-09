import {randomUUID,createHash} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {isAbsolute,join} from 'node:path';
import {applyManagedPatch,proposeLiteralPatch,type LiteralPatchDraft,type SelectorLocation} from '../../patch-engine/src/index.ts';
import {analyzeSource} from '../../source-analyzer/src/index.ts';
import {activateManagedRevision,listManagedRevisions} from './history.ts';
export interface ProposalReceipt {
 proposalId:string;scriptId:string;oldSelector:string;newSelector:string;
 originalHash:string;baseHash:string;proposedHash:string;preview:string;
}
export interface AppliedReceipt {backupPath:string;managedPath:string;hash:string}
interface PendingProposal {sourcePath:string;workingPath:string;originalHash:string;scriptId:string;baseRevisionKind:'original'|'revision';draft:LiteralPatchDraft}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Explicit two-stage workflow. Original script is not overwritten. */
export function createRepairWorkflow({managedRoot}:{managedRoot:string}){
 if(!isAbsolute(managedRoot))throw new Error('Managed root must be absolute');
 const pending=new Map<string,PendingProposal>();
 const applying=new Set<string>();
 return {
  invalidatePending():void{pending.clear();},
  async propose({sourcePath,scriptId,oldSelector,newSelector,selectorLocation}:{sourcePath:string;scriptId:string;oldSelector:string;newSelector:string;selectorLocation?:SelectorLocation|undefined}):Promise<ProposalReceipt>{
   if(!isAbsolute(sourcePath))throw new Error('Source path must be absolute');
   if(!/^[a-z0-9_-]{1,64}$/i.test(scriptId))throw new Error('Unsafe scriptId');
   const file=await lstat(sourcePath);
   if(!file.isFile()||file.isSymbolicLink())throw new Error('Source must be an ordinary file');
   if(file.size>512*1024)throw new Error('Script is too large');
   const originalBytes=await readPinnedRegularFile(sourcePath,{maxBytes:512*1024,expected:file});
   const originalHash=sha(originalBytes);
   const revisions=await listManagedRevisions({managedRoot,scriptId});
   const currentPath=join(managedRoot,'managed',scriptId,'current.user.js');
   let currentInfo:Awaited<ReturnType<typeof lstat>>|undefined;
   try{currentInfo=await lstat(currentPath);}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   let workingPath=sourcePath,workingBytes=originalBytes;
   let baseRevisionKind:'original'|'revision'='original';
   if(currentInfo){
    if(currentInfo.isSymbolicLink()||!currentInfo.isFile()||currentInfo.size>512*1024)
     throw new Error('Unsafe managed current file');
    const trustedOriginal=revisions.some(r=>r.kind==='original'&&r.hash===originalHash);
    if(!trustedOriginal)throw new Error('Original source hash changed since the first managed revision; rescan before repairing');
    const currentBytes=await readPinnedRegularFile(currentPath,{maxBytes:512*1024,expected:currentInfo}),currentHash=sha(currentBytes);
    const archived=revisions.find(r=>r.hash===currentHash);
    if(!archived)throw new Error('Managed current contains unverified external edits; refusing repair');
    workingPath=currentPath;workingBytes=currentBytes;baseRevisionKind=archived.kind;
   }else if(revisions.length){
    throw new Error('Managed current is missing; restore an archived revision before repairing');
   }
   // Literal replacements can change the length of an earlier selector on the
   // same source line. Translate the originally scanned AST call position to the
   // corresponding call in the verified managed revision by stable AST order.
   let updatedLocation=selectorLocation;
   if(workingPath!==sourcePath&&selectorLocation){
    const originalCalls=analyzeSource({scriptId,sourceBytes:originalBytes}).selectorRecords;
    const activeCalls=analyzeSource({scriptId,sourceBytes:workingBytes}).selectorRecords;
    if(originalCalls.length!==activeCalls.length)
     throw new Error('Managed revision AST structure differs from original; refusing positional patch');
    const ordinal=originalCalls.findIndex(record=>
     record.method===selectorLocation.method&&
     record.sourceRange.start.line===selectorLocation.line&&
     record.sourceRange.start.column===selectorLocation.column);
    const active=ordinal>=0?activeCalls[ordinal]:undefined;
    if(!active||active.method!==selectorLocation.method||active.expression!==oldSelector||
       active.dynamicKind!=='literal')
     throw new Error('Original locator position no longer maps to the same managed AST call');
    updatedLocation={method:active.method,line:active.sourceRange.start.line,column:active.sourceRange.start.column};
   }
   const draft=proposeLiteralPatch({sourceBytes:workingBytes,oldSelector,newSelector,selectorLocation:updatedLocation});
   if(pending.size>=100)throw new Error('Too many pending patch proposals');
   const proposalId=randomUUID();
   pending.set(proposalId,{sourcePath,workingPath,originalHash,baseRevisionKind,scriptId,draft});
   const focus=draft.sourceRange.start;
   const preview=draft.proposedSource.slice(Math.max(0,focus-90),Math.min(draft.proposedSource.length,focus+150));
   return {proposalId,scriptId,oldSelector,newSelector,originalHash,baseHash:draft.baseHash,proposedHash:draft.proposedHash,preview};
  },
  async restore({scriptId,hash,approved}:{scriptId:string;hash:string;approved:boolean}):Promise<{hash:string;activePath:string}>{
   if(approved!==true)throw new Error('Explicit rollback approval required');
   if(!/^[a-z0-9_-]{1,64}$/i.test(scriptId))throw new Error('Unsafe scriptId');
   if(applying.has(scriptId))
    throw new Error('Another managed revision operation for this script is already in progress');
   // Use the same synchronous per-script lock as apply(): restoration must not
   // interleave the immutable archive write and activation of an approved patch.
   applying.add(scriptId);
   try{return await activateManagedRevision({managedRoot,scriptId,hash,approved:true});}
   finally{applying.delete(scriptId);}
  },
  async apply({proposalId,approved}:{proposalId:string;approved:boolean}):Promise<AppliedReceipt>{
   if(approved!==true)throw new Error('Explicit approval required');
   const found=pending.get(proposalId);
   if(!found)throw new Error('Proposal not found or already applied');
   // Lock synchronously, before any filesystem await. Otherwise two approvals
   // can both pass the missing-current check and race to activate distinct
   // revisions. The lock is per script so unrelated repairs remain independent.
   if(applying.has(found.scriptId))
    throw new Error('Another repair approval for this script is already in progress');
   applying.add(found.scriptId);
   pending.delete(proposalId);
   try{
   const sourceInfo=await lstat(found.sourcePath);
   if(!sourceInfo.isFile()||sourceInfo.isSymbolicLink()||
      sha(await readPinnedRegularFile(found.sourcePath,{maxBytes:512*1024,expected:sourceInfo}))!==found.originalHash)
    throw new Error('Original source hash mismatch after patch proposal; refusing stale repair'); 
   // A preview staged before the first managed revision must never overwrite a
   // different preview that was approved in the meantime. Earlier versions
   // validated only the unchanged original source and lost the first repair.
   if(found.workingPath===found.sourcePath){
    const active=join(managedRoot,'managed',found.scriptId,'current.user.js');
    const present=await lstat(active).then(()=>true,(error:unknown)=>{
     if((error as NodeJS.ErrnoException).code==='ENOENT')return false;
     throw error;
    });
    if(present||(await listManagedRevisions({managedRoot,scriptId:found.scriptId})).length)
     throw new Error('Stale repair proposal: managed revision changed after preview; create a fresh proposal');
   }
   const receipt=await applyManagedPatch({sourcePath:found.workingPath,managedRoot,scriptId:found.scriptId,draft:found.draft,expectedHash:found.draft.baseHash,approved:true,baseRevisionKind:found.baseRevisionKind});
   await activateManagedRevision({managedRoot,scriptId:found.scriptId,hash:receipt.hash,approved:true});
   return receipt;
   }finally{applying.delete(found.scriptId);}
  },
 };
}
