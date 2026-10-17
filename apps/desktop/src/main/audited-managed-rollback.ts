import {randomUUID} from 'node:crypto';
import type {openRollbackAuditJournal} from '../../../../packages/audit-journal/src/rollback-events.ts';
type Journal=ReturnType<typeof openRollbackAuditJournal>;
const SHA=/^[a-f0-9]{64}$/;
/** Manual rollback is an approved activation, NOT a fabricated passed V1 repair.
 * Reserve immutable evidence before any write and persist a separate verified
 * outcome before reporting success. Crashed or uncertain writes need review.
 */
export async function executeAuditedManagedRollback(input:{
 journal:Journal;scriptId:string;targetHash:string;expectedCurrentHash:string|null;
 sourceAuditRevisionId?:string|null;targetAuditRevisionId?:string|null;
 restore:(expectedCurrentHash:string|null)=>Promise<{hash:string;activePath:string}>;
 newId?:()=>string;now?:()=>string;
}):Promise<{hash:string;activePath:string}>{
 if(!input||!input.journal||typeof input.journal.begin!=='function'||
    typeof input.journal.finish!=='function'||typeof input.journal.get!=='function'||
    typeof input.restore!=='function'||typeof input.targetHash!=='string'||!SHA.test(input.targetHash)||
    (input.expectedCurrentHash!==null&&
     (typeof input.expectedCurrentHash!=='string'||!SHA.test(input.expectedCurrentHash))))
  throw new Error('Invalid audited managed rollback authorization');
 const eventId=(input.newId??randomUUID)(),now=input.now??(()=>new Date().toISOString());
 // Intent is synchronous, durable and before restore. A failed journal write
 // is a hard block; never turn it into an unaudited managed activation.
 input.journal.begin({id:eventId,scriptId:input.scriptId,
  previousHash:input.expectedCurrentHash,targetHash:input.targetHash,
  sourceAuditRevisionId:input.sourceAuditRevisionId??null,
  targetAuditRevisionId:input.targetAuditRevisionId??null,at:now(),
 });
 let result:{hash:string;activePath:string};
 try{
  result=await input.restore(input.expectedCurrentHash);
  if(!result||result.hash!==input.targetHash||
     typeof result.activePath!=='string'||result.activePath.length===0)
   throw new Error('Unverified activation');
 }catch{
  // An exception during publish can occur AFTER the bytes reached current.
  // Record uncertainty, not "failed without write", and never surface paths,
  // script source or exception text from the filesystem to the renderer.
  try{input.journal.finish({id:eventId,outcome:'uncertain',
   targetHash:input.targetHash,at:now()});}catch{}
  throw new Error('Managed rollback activation outcome uncertain; manual review required');
 }
 try{
  input.journal.finish({id:eventId,outcome:'committed',
   targetHash:input.targetHash,at:now()});
  const saved=input.journal.get(eventId);
  if(saved?.outcome!=='committed'||saved.targetHash!==result.hash||
     saved.previousHash!==input.expectedCurrentHash)
   throw new Error('Audit receipt mismatch');
 }catch{
  // Keep the durable intent if final SQLite persistence failed. Returning
  // success here would silently misclassify an unaudited user data change.
  throw new Error('Managed rollback audit completion uncertain; manual review required');
 }
 return result;
}
