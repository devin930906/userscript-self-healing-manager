import {createHash} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {analyzeSource} from '../../source-analyzer/src/index.ts';
import {listManagedRevisions} from './history.ts';

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export interface VerifiedManagedLocator {
 readonly method:string;
 readonly expression:string;
 readonly runtimeRequired:false;
 readonly revisionHash:string;
 readonly validationLevel:'managed-static-only';
}
/**
 * Read the REAL, currently activated managed revision and pin it to one
 * immutable archived patch before a separate read-only V1 DOM contract.
 *
 * This does not execute a userscript or prove Tampermonkey injection.
 */
export async function readVerifiedManagedLocator({managedRoot,scriptId,revisionHash,selectorIndex}:{
 managedRoot:string;scriptId:string;revisionHash:string;selectorIndex:number;
}):Promise<VerifiedManagedLocator>{
 if(typeof managedRoot!=='string'||!isAbsolute(managedRoot)||
    typeof scriptId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(scriptId)||
    typeof revisionHash!=='string'||!/^[a-f0-9]{64}$/.test(revisionHash)||
    !Number.isSafeInteger(selectorIndex)||selectorIndex<0||selectorIndex>=50)
  throw new Error('Invalid managed revision, selector index or path');
 const current=join(managedRoot,'managed',scriptId,'current.user.js');
 const requireUnlocked=async():Promise<void>=>{
  try{await lstat(current+'.write-lock');}
  catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT')return;
   throw error;
  }
  throw new Error('Managed current writer lock is present: cannot certify a revision during active or orphaned write');
 };
 await requireUnlocked();
 const archives=await listManagedRevisions({managedRoot,scriptId});
 if(!archives.some(entry=>entry.kind==='revision'&&entry.hash===revisionHash))
  throw new Error('Approved managed revision archive not found or corrupt');
 const info=await lstat(current);
 if(!info.isFile()||info.isSymbolicLink())
  throw new Error('Unsafe managed current symlink or nonregular file');
 const bytes=await readPinnedRegularFile(current,{maxBytes:512*1024,expected:info});
 if(digest(bytes)!==revisionHash)
  throw new Error('Managed current hash changed since approved revision; refusing stale V1 check');
 const analysis=analyzeSource({scriptId,sourceBytes:bytes});
 if(analysis.encoding==='invalid'||analysis.parseDiagnostics.length>0)
  throw new Error('Managed current source cannot be statically parsed');
 const locator=analysis.selectorRecords[selectorIndex];
 if(!locator||locator.receiver!=='document'||locator.runtimeRequired||locator.dynamicKind!=='literal'||
    !['querySelector','querySelectorAll','getElementById',
      'getElementsByName','getElementsByClassName'].includes(locator.method)||
    !locator.expression||locator.expression.length>1024)
  throw new Error('Managed selector index is unsupported, dynamic, or missing');
 // Do not certify a locator if a different manager began writing during
 // the pinned read/parse. This is a read-only snapshot guard, not a hostile
 // process transaction; guarded V1 repeats verification after DOM probes.
 await requireUnlocked();
 return {method:locator.method,expression:locator.expression,
  runtimeRequired:false,revisionHash,validationLevel:'managed-static-only'};
}
