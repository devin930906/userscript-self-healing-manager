const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LIMIT=256;

/**
 * Main-only cancellation handles for currently native-approved batch writes.
 * No renderer supplied callback, script source, browser target or filesystem
 * path enters this registry. Cancellation is best-effort: a write already
 * in flight can still commit, and MUST not be reported as a rollback.
 */
export function createActiveBatchCancellation(){
 type ActiveSession={
  cancel:()=>void;
  pause:(()=>boolean)|undefined;
  resume:(()=>void)|undefined;
  paused:boolean;
 };
 const sessions=new Map<string,ActiveSession>();
 const assertId=(id:string)=>{
  if(typeof id!=='string'||!UUID.test(id))
   throw new Error('Invalid active batch cancellation identity');
 };
 return Object.freeze({
  attach(id:string,cancel:()=>void,
   controls?:{pause:()=>boolean;resume:()=>void}):()=>void{
   assertId(id);
   if(typeof cancel!=='function'||sessions.has(id)||sessions.size>=LIMIT||
      (controls!==undefined&&(!controls||typeof controls.pause!=='function'||typeof controls.resume!=='function')))
    throw new Error('Invalid or duplicate active batch cancellation registration');
   const session:ActiveSession={cancel,pause:controls?.pause,resume:controls?.resume,paused:false};
   sessions.set(id,session);
   return ()=>{
    // Stale cleanup must never revoke another session that reused this ID.
    if(sessions.get(id)===session)sessions.delete(id);
   };
  },
  cancel(id:string):boolean{
   assertId(id);
   const session=sessions.get(id);
   if(!session)return false;
   session.cancel();
   return true;
  },
  pause(id:string):boolean{
   assertId(id);
   const session=sessions.get(id);
   if(!session?.pause||session.paused)return false;
   const paused=session.pause();
   if(paused)session.paused=true;
   return paused;
  },
  resume(id:string):boolean{
   assertId(id);
   const session=sessions.get(id);
   if(!session?.resume||!session.paused)return false;
   session.resume();
   session.paused=false;
   return true;
  },
 });
}
