import type {RepairTaskStatus} from '../../../../packages/scan-service/src/repair-task-queue.ts';

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
 void input;
 throw new Error('Durable guarded V1 apply is not implemented');
}
