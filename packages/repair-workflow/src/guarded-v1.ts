/** Guard for an already approved MANAGED revision only. Never touches the
 * original userscript, triggers a webpage interaction, or claims V2/V3/V4.
 * An approved apply must have happened in a separate guarded transaction.
 *
 * If a strict two-sample V1 observation cannot be established, restore the
 * exact immutable predecessor. A failed restore is explicitly BLOCKED, never
 * disguised as a successful rollback.
 */
export interface GuardedV1Result {
 readonly status:'retained-v1'|'rolled-back-v1'|'rollback-blocked';
 readonly appliedHash:string;
 readonly activeHash:string|null;
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
 readonly functionalVerified:false;
 readonly managerVerified:false;
}
export interface GuardedV1Deps {
 verify:()=>Promise<unknown>;
 restore:(previousHash:string)=>Promise<{hash:string;activePath:string}>;
}
export async function guardAppliedManagedRevision({approved,scriptId,appliedHash,previousHash,verify,restore}:{
 approved:boolean;scriptId:string;appliedHash:string;previousHash:string;
} & GuardedV1Deps):Promise<GuardedV1Result>{
 if(approved!==true||typeof scriptId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(scriptId)||
    typeof appliedHash!=='string'||!/^[a-f0-9]{64}$/.test(appliedHash)||
    typeof previousHash!=='string'||!/^[a-f0-9]{64}$/.test(previousHash)||
    previousHash===appliedHash||typeof verify!=='function'||typeof restore!=='function')
  throw new Error('Invalid approved managed V1 safety guard or revision hash');
 const base={
  appliedHash,V2:'blocked' as const,V3:'not-configured' as const,V4:'not-configured' as const,
  functionalVerified:false as const,managerVerified:false as const,
 };
 try{
  const evidence=await verify() as Record<string,unknown>|null;
  if(evidence&&evidence.status==='passed'&&evidence.evidenceLevel==='V1'&&
     evidence.attempts===2&&typeof evidence.matchCount==='number'&&
     Number.isSafeInteger(evidence.matchCount)&&evidence.matchCount>=1&&
     evidence.V2==='blocked'&&evidence.V3==='not-configured'&&
     evidence.V4==='not-configured'&&evidence.functionalVerified===false&&
     evidence.managerVerified===false)
   return {...base,status:'retained-v1',activeHash:appliedHash};
 }catch{
  // Loss of Chrome connectivity is NOT permission to keep a patch as verified.
 }
 try{
  const restored=await restore(previousHash);
  if(!restored||restored.hash!==previousHash||
     typeof restored.activePath!=='string'||!restored.activePath)
   return {...base,status:'rollback-blocked',activeHash:null};
  return {...base,status:'rolled-back-v1',activeHash:previousHash};
 }catch{
  // External edits and filesystem failure must remain visible as blocked.
  return {...base,status:'rollback-blocked',activeHash:null};
 }
}
