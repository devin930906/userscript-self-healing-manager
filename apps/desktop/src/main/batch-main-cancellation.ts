const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LIMIT=256;

/**
 * Main-only cancellation handles for currently native-approved batch writes.
 * No renderer supplied callback, script source, browser target or filesystem
 * path enters this registry. Cancellation is best-effort: a write already
 * in flight can still commit, and MUST not be reported as a rollback.
 */
export function createActiveBatchCancellation(){
 const sessions=new Map<string,()=>void>();
 const assertId=(id:string)=>{
  if(typeof id!=='string'||!UUID.test(id))
   throw new Error('Invalid active batch cancellation identity');
 };
 return Object.freeze({
  attach(id:string,cancel:()=>void):()=>void{
   assertId(id);
   if(typeof cancel!=='function'||sessions.has(id)||sessions.size>=LIMIT)
    throw new Error('Invalid or duplicate active batch cancellation registration');
   sessions.set(id,cancel);
   return ()=>{
    // Stale cleanup must never revoke another session that reused this ID.
    if(sessions.get(id)===cancel)sessions.delete(id);
   };
  },
  cancel(id:string):boolean{
   assertId(id);
   const callback=sessions.get(id);
   if(!callback)return false;
   callback();
   return true;
  },
 });
}
