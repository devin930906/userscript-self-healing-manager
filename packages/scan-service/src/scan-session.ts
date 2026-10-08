import {randomUUID} from 'node:crypto';

/** A scan epoch is independent of file names or content hashes.
 * A newer scan supersedes an older pending scan; a failed scan leaves the
 * latest committed result intact. Renderer callers must echo the epoch for
 * every paginated CDP request, and main must re-check after await boundaries.
 */
export class ScanSessionCoordinator<T extends object>{
 private generation=0;
 private active:(T&{scanId:string})|null=null;

 async replace(task:()=>Promise<T>):Promise<T&{scanId:string}>{
  const generation=++this.generation;
  const value=await task();
  if(generation!==this.generation)throw new Error('Stale scan completion superseded by a newer scan');
  const session={...value,scanId:randomUUID()};
  this.active=session;
  return session;
 }
 require(scanId:string):T&{scanId:string}{
  if(!this.active||typeof scanId!=='string'||!scanId||
     scanId!==this.active.scanId)
   throw new Error('Stale scan identity: rescan or restart CDP diagnosis');
  return this.active;
 }
 assertCurrent(session:T&{scanId:string}):void{
  if(!this.active||this.active!==session)
   throw new Error('Stale scan identity changed while diagnosing the page');
 }
}
