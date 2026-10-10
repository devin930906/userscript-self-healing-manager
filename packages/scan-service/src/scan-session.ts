import {randomUUID} from 'node:crypto';

/** A scan epoch is independent of file names or content hashes.
 * A newer scan supersedes an older pending scan; a failed scan leaves the
 * latest committed result intact. Renderer callers must echo the epoch for
 * every paginated CDP request, and main must re-check after await boundaries.
 */
export class ScanSessionCoordinator<T extends object>{
 private generation=0;
 private readyGeneration=0;
 private active:(T&{scanId:string})|null=null;

 async replace(task:()=>Promise<T>):Promise<T&{scanId:string}>{
  // Suspending the previous authorization synchronously prevents a late
  // CDP result from being accepted while new script bytes are imported.
  const generation=++this.generation;
  try{
   const value=await task();
   if(generation!==this.generation)throw new Error('Stale scan completion superseded by a newer scan');
   const session={...value,scanId:randomUUID()};
   this.active=session;
   this.readyGeneration=generation;
   return session;
  }catch(error){
   // If the most recent import failed, restore only the last committed
   // snapshot; never activate a superseded intermediate import.
   if(generation===this.generation)this.readyGeneration=generation;
   throw error;
  }
 }
 require(scanId:string):T&{scanId:string}{
  if(this.readyGeneration!==this.generation||!this.active||
     typeof scanId!=='string'||!scanId||scanId!==this.active.scanId)
   throw new Error('Stale scan identity or import in progress: restart CDP diagnosis');
  return this.active;
 }
 assertCurrent(session:T&{scanId:string}):void{
  if(this.readyGeneration!==this.generation||!this.active||this.active!==session)
   throw new Error('Stale scan identity changed or import in progress');
 }
}
