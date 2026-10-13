import type {RepairTaskStatus} from '../../../../packages/scan-service/src/repair-task-queue.ts';
import {executeDurableApprovedBatch} from './durable-batch-apply.ts';

/**
 * An approved V1 repair is not safe to retain if the durable journal fails
 * AFTER the managed revision has been activated. Preserve the approved exact
 * predecessor through a caller-owned compare-and-swap rollback.
 *
 * This is not a crash-atomic transaction. A process crash or a failed restore
 * remains uncertain, never reported as V1 retained, and requires offline
 * review. This helper does not run scripts or alter original source files.
 */
export async function executeDurableGuardedManagedApply<T extends {hash:string}>(input:{
 readonly dataRoot:string;
 readonly approvalId:string;
 readonly scriptId:string;
 readonly previousHash:string;
 readonly preflight:()=>boolean|Promise<boolean>;
 readonly write:()=>Promise<T>;
 readonly restore:(expectedCurrentHash:string)=>Promise<{hash:string;activePath:string}>;
 readonly onProgress?:(status:RepairTaskStatus)=>void;
 readonly onRegisterCancel?:(cancel:()=>void,pause:()=>boolean,resume:()=>void)=>(()=>void);
}):Promise<T>{
 if(!input||typeof input!=='object'||Array.isArray(input)||
    typeof input.previousHash!=='string'||!/^[a-f0-9]{64}$/.test(input.previousHash)||
    typeof input.restore!=='function')
  throw new Error('Invalid guarded managed revision predecessor or rollback');
 let written:T|undefined;
 try{
  return await executeDurableApprovedBatch({
   dataRoot:input.dataRoot,approvalId:input.approvalId,scriptId:input.scriptId,
   preflight:input.preflight,
   write:async()=>{
    const receipt=await input.write();
    if(!receipt||typeof receipt.hash!=='string'||!/^[a-f0-9]{64}$/.test(receipt.hash))
     throw new Error('Managed revision activation receipt is unverified');
    written=receipt;
    return receipt;
   },
   ...(input.onProgress?{onProgress:input.onProgress}:{}),
   ...(input.onRegisterCancel?{onRegisterCancel:input.onRegisterCancel}:{}),
  });
 }catch{
  if(written){
   let reverted=false;
   try{
    const receipt=await input.restore(written.hash);
    reverted=receipt?.hash===input.previousHash&&
     typeof receipt.activePath==='string'&&receipt.activePath.length>0;
   }catch{
    // Crash, external edit, filesystem lock, and invalid archived predecessor
    // are NOT evidence of a successful rollback.
   }
   if(!reverted)
    throw new Error('Guarded managed repair journal failed; rollback blocked, manual review required');
   throw new Error('Guarded managed repair journal failed; prior revision restored');
  }
  throw new Error('Durable guarded managed repair blocked; fresh review required');
 }
}
