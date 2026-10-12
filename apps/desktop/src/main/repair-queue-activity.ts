import type {RepairTaskStatus} from '../../../../packages/scan-service/src/repair-task-queue.ts';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATES:readonly RepairTaskStatus[]=['queued','running','completed','failed','blocked','cancelled'];
const ALLOWED:Record<RepairTaskStatus,readonly RepairTaskStatus[]>={
 queued:['queued','running','blocked','cancelled'],
 running:['running','completed','failed','blocked','cancelled'],
 completed:['completed'],
 failed:['failed','queued','blocked','cancelled'],
 blocked:['blocked'],
 cancelled:['cancelled','blocked'],
};
const LIMIT=256;
export interface RepairQueueActivitySummary{
 readonly queued:number;
 readonly running:number;
 readonly completed:number;
 readonly failed:number;
 readonly blocked:number;
 readonly cancelled:number;
}
/**
 * Session-only Main-process progress ledger.
 * Keys are private native-reviewed approval UUIDs, NEVER serialized to IPC.
 * UI sees only bounded aggregate counts, not paths, script names, source data,
 * approval handles or promises. This ledger neither approves nor dispatches.
 */
export function createRepairQueueActivity(){
 const states=new Map<string,RepairTaskStatus>();
 const snapshot=():RepairQueueActivitySummary=>{
  const result:{-readonly [K in keyof RepairQueueActivitySummary]:number}={
   queued:0,running:0,completed:0,failed:0,blocked:0,cancelled:0,
  };
  for(const status of states.values())result[status]++;
  return Object.freeze(result);
 };
 return Object.freeze({
  observe(id:string,status:RepairTaskStatus):void{
   if(typeof id!=='string'||!UUID.test(id)||!STATES.includes(status))
    throw new Error('Invalid repair queue activity state or identity');
   const prior=states.get(id);
   if(prior&&!ALLOWED[prior].includes(status))
    throw new Error('Unsafe terminal repair queue activity transition');
   // Keep at most LIMIT session observations. Evict only historical,
   // terminal rows; never hide work still queued or running.
   if(!prior&&states.size>=LIMIT){
    for(const [oldId,oldStatus] of states){
     if(!['queued','running'].includes(oldStatus)){
      states.delete(oldId);
      break;
     }
    }
    if(states.size>=LIMIT)
     throw new Error('Repair queue activity capacity reached');
   }
   states.set(id,status);
  },
  snapshot,
 });
}
