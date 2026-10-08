import {randomUUID,createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {applyManagedPatch,proposeLiteralPatch,type LiteralPatchDraft,type SelectorLocation} from '../../patch-engine/src/index.ts';
import {activateManagedRevision,listManagedRevisions} from './history.ts';
export interface ProposalReceipt {
 proposalId:string;scriptId:string;oldSelector:string;newSelector:string;
 baseHash:string;proposedHash:string;preview:string;
}
export interface AppliedReceipt {backupPath:string;managedPath:string;hash:string}
interface PendingProposal {sourcePath:string;workingPath:string;originalHash:string;scriptId:string;baseRevisionKind:'original'|'revision';draft:LiteralPatchDraft}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Explicit two-stage workflow. Original script is not overwritten. */
export function createRepairWorkflow({managedRoot}:{managedRoot:string}){
 if(!isAbsolute(managedRoot))throw new Error('Managed root must be absolute');
 const pending=new Map<string,PendingProposal>();
 return {
  async propose({sourcePath,scriptId,oldSelector,newSelector,selectorLocation}:{sourcePath:string;scriptId:string;oldSelector:string;newSelector:string;selectorLocation?:SelectorLocation|undefined}):Promise<ProposalReceipt>{
   if(!isAbsolute(sourcePath))throw new Error('Source path must be absolute');
   if(!/^[a-z0-9_-]{1,64}$/i.test(scriptId))throw new Error('Unsafe scriptId');
   const file=await lstat(sourcePath);
   if(!file.isFile()||file.isSymbolicLink())throw new Error('Source must be an ordinary file');
   if(file.size>512*1024)throw new Error('Script is too large');
   const originalBytes=await readFile(sourcePath);
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
    const currentBytes=await readFile(currentPath),currentHash=sha(currentBytes);
    const archived=revisions.find(r=>r.hash===currentHash);
    if(!archived)throw new Error('Managed current contains unverified external edits; refusing repair');
    workingPath=currentPath;workingBytes=currentBytes;baseRevisionKind=archived.kind;
   }else if(revisions.length){
    throw new Error('Managed current is missing; restore an archived revision before repairing');
   }
   const draft=proposeLiteralPatch({sourceBytes:workingBytes,oldSelector,newSelector,selectorLocation});
   if(pending.size>=100)throw new Error('Too many pending patch proposals');
   const proposalId=randomUUID();
   pending.set(proposalId,{sourcePath,workingPath,originalHash,baseRevisionKind,scriptId,draft});
   const focus=draft.sourceRange.start;
   const preview=draft.proposedSource.slice(Math.max(0,focus-90),Math.min(draft.proposedSource.length,focus+150));
   return {proposalId,scriptId,oldSelector,newSelector,baseHash:draft.baseHash,proposedHash:draft.proposedHash,preview};
  },
  async apply({proposalId,approved}:{proposalId:string;approved:boolean}):Promise<AppliedReceipt>{
   if(approved!==true)throw new Error('Explicit approval required');
   const found=pending.get(proposalId);
   if(!found)throw new Error('Proposal not found or already applied');
   pending.delete(proposalId);
   const sourceInfo=await lstat(found.sourcePath);
   if(!sourceInfo.isFile()||sourceInfo.isSymbolicLink()||sha(await readFile(found.sourcePath))!==found.originalHash)
    throw new Error('Original source hash mismatch after patch proposal; refusing stale repair');
   const receipt=await applyManagedPatch({sourcePath:found.workingPath,managedRoot,scriptId:found.scriptId,draft:found.draft,expectedHash:found.draft.baseHash,approved:true,baseRevisionKind:found.baseRevisionKind});
   await activateManagedRevision({managedRoot,scriptId:found.scriptId,hash:receipt.hash,approved:true});
   return receipt;
  },
 };
}
