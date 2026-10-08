import {randomUUID} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {applyManagedPatch,proposeLiteralPatch,type LiteralPatchDraft} from '../../patch-engine/src/index.ts';
export interface ProposalReceipt {
 proposalId:string;scriptId:string;oldSelector:string;newSelector:string;
 baseHash:string;proposedHash:string;preview:string;
}
export interface AppliedReceipt {backupPath:string;managedPath:string;hash:string}
interface PendingProposal {sourcePath:string;scriptId:string;draft:LiteralPatchDraft}
/** Explicit two-stage workflow. Original script is not overwritten. */
export function createRepairWorkflow({managedRoot}:{managedRoot:string}){
 if(!isAbsolute(managedRoot))throw new Error('Managed root must be absolute');
 const pending=new Map<string,PendingProposal>();
 return {
  async propose({sourcePath,scriptId,oldSelector,newSelector}:{sourcePath:string;scriptId:string;oldSelector:string;newSelector:string}):Promise<ProposalReceipt>{
   if(!isAbsolute(sourcePath))throw new Error('Source path must be absolute');
   if(!/^[a-z0-9_-]{1,64}$/i.test(scriptId))throw new Error('Unsafe scriptId');
   const file=await lstat(sourcePath);
   if(!file.isFile()||file.isSymbolicLink())throw new Error('Source must be an ordinary file');
   if(file.size>512*1024)throw new Error('Script is too large');
   const bytes=await readFile(sourcePath);
   const draft=proposeLiteralPatch({sourceBytes:bytes,oldSelector,newSelector});
   if(pending.size>=100)throw new Error('Too many pending patch proposals');
   const proposalId=randomUUID();
   pending.set(proposalId,{sourcePath,scriptId,draft});
   const focus=draft.sourceRange.start;
   const preview=draft.proposedSource.slice(Math.max(0,focus-90),Math.min(draft.proposedSource.length,focus+150));
   return {proposalId,scriptId,oldSelector,newSelector,baseHash:draft.baseHash,proposedHash:draft.proposedHash,preview};
  },
  async apply({proposalId,approved}:{proposalId:string;approved:boolean}):Promise<AppliedReceipt>{
   if(approved!==true)throw new Error('Explicit approval required');
   const found=pending.get(proposalId);
   if(!found)throw new Error('Proposal not found or already applied');
   pending.delete(proposalId);
   return applyManagedPatch({sourcePath:found.sourcePath,managedRoot,scriptId:found.scriptId,draft:found.draft,expectedHash:found.draft.baseHash,approved:true});
  },
 };
}
