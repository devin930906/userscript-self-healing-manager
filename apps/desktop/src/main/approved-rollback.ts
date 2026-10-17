/**
 * FR-028 / RG-06: a renderer's approved:true is a request, never native consent.
 * Pin the verified *current* managed revision to the native dialog and require
 * the same SHA-256 when the existing cross-process activation lock commits.
 * No user script is run or original source file modified.
 */
type ManagedRollbackInspection=Readonly<{
 status:string;
 activeHash:string|null;
}>;
type VerifiedRevision=Readonly<{hash:string;verified:boolean}>;

const SHA256=/^[a-f0-9]{64}$/;

export async function approveManagedRollback(deps:Readonly<{
 targetHash:string;
 inspect:()=>Promise<ManagedRollbackInspection>;
 list:()=>Promise<readonly VerifiedRevision[]>;
 assertCurrent:()=>void;
 confirm:(review:Readonly<{currentHash:string|null;targetHash:string}>)=>Promise<{response:number}>;
 restore:(expectedCurrentHash:string|null)=>Promise<{hash:string;activePath:string}>;
}>):Promise<{hash:string;activePath:string}>{
 if(!deps||typeof deps.targetHash!=='string'||!SHA256.test(deps.targetHash)||
    typeof deps.inspect!=='function'||typeof deps.list!=='function'||
    typeof deps.assertCurrent!=='function'||typeof deps.confirm!=='function'||
    typeof deps.restore!=='function')
  throw new Error('Invalid managed rollback authorization request');
 const inspect=async()=>{
  deps.assertCurrent();
  const state=await deps.inspect();
  deps.assertCurrent();
  const healthy=state?.status==='healthy'&&typeof state.activeHash==='string'&&
    SHA256.test(state.activeHash);
  // A previously archived managed revision must remain recoverable when an
  // interrupted activation left current.user.js absent. Do not silently
  // restore it: bind that absence to native consent and a null CAS.
  const missingCurrent=state?.status==='missing-current'&&state.activeHash===null;
  if(!healthy&&!missingCurrent)
   throw new Error('Managed current is not healthy or safely recoverable');
  const revisions=await deps.list();
  deps.assertCurrent();
  if(!Array.isArray(revisions)||!revisions.some(revision=>
    revision?.verified===true&&revision.hash===deps.targetHash))
   throw new Error('Selected managed revision is missing or unsafe');
  return Object.freeze({status:healthy?'healthy':'missing-current',currentHash:state.activeHash});
 };
 const reviewed=await inspect();
 if(reviewed.currentHash===deps.targetHash)
  throw new Error('Selected revision is already the current managed revision');
 const answer=await deps.confirm(Object.freeze({
  currentHash:reviewed.currentHash,targetHash:deps.targetHash,
 }));
 if(!answer||answer.response!==1)
  throw new Error('Managed revision rollback was not approved');
 const after=await inspect();
 if(after.status!==reviewed.status||after.currentHash!==reviewed.currentHash)
  throw new Error('Managed current changed during native rollback confirmation');
 deps.assertCurrent();
 // Cross-process activation compares the exact SHA-256 predecessor OR null
 // (file absent) inside its write lock; prior inspection is not a lock.
 const receipt=await deps.restore(reviewed.currentHash);
 if(!receipt||receipt.hash!==deps.targetHash||
    typeof receipt.activePath!=='string'||!receipt.activePath)
  throw new Error('Managed rollback result was not verified');
 return receipt;
}
