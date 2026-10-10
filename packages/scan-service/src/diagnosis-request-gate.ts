/**
 * Main-process authorization epoch for paginated CDP diagnoses.
 *
 * The renderer's pause/cancel state is only UX. A cancellation can arrive
 * while an already dispatched CDP request awaits Chrome. Before storing any
 * evidence, Main must prove that the exact page request is still current.
 *
 * This is an in-memory lease, not an OS process interrupt. The current CDP
 * read may finish, but its cancelled result MUST never be persisted or sent
 * back as valid evidence.
 */
export interface DiagnosisTicket {
 readonly scanId:string;
 readonly targetId:string;
 readonly offset:number;
 readonly epoch:number;
}
interface Active {
 epoch:number;
 expectedOffset:number;
 totalItems:number|null;
 inFlight:boolean;
}
const identity=(scanId:string,targetId:string)=>{
 if(typeof scanId!=='string'||!scanId||scanId.length>128||
    typeof targetId!=='string'||!targetId||targetId.length>128)
  throw new Error('Invalid diagnosis request identity');
 return JSON.stringify([scanId,targetId]);
};

export class DiagnosisRequestGate {
 private sequence=0;
 private readonly active=new Map<string,Active>();
 begin({scanId,targetId,offset}:{scanId:string;targetId:string;offset:number}):DiagnosisTicket{
  const key=identity(scanId,targetId);
  if(!Number.isSafeInteger(offset)||offset<0||offset>1000||offset%25!==0)
   throw new Error('Invalid diagnosis page offset');
  const existing=this.active.get(key);
  if(existing?.inFlight)
   throw new Error('Another diagnosis page is already running for this target');
  if(offset===0){
   // An explicit, fresh first-page request creates a new batch epoch. Only a
   // completed or cancelled older run can be restarted here.
   const epoch=++this.sequence;
   this.active.set(key,{epoch,expectedOffset:0,totalItems:null,inFlight:true});
   return Object.freeze({scanId,targetId,offset,epoch});
  }
  if(!existing||existing.expectedOffset!==offset)
   throw new Error('Diagnosis page is out of order; start at offset zero');
  // Every attempt gets a fresh lease, even if it retries the very same
  // offset after a transport timeout. A delayed old CDP response cannot
  // become current again when the next attempt begins.
  existing.epoch=++this.sequence;
  existing.inFlight=true;
  return Object.freeze({scanId,targetId,offset,epoch:existing.epoch});
 }
 isCurrent(ticket:DiagnosisTicket):boolean{
  const current=this.active.get(identity(ticket.scanId,ticket.targetId));
  return Boolean(current?.epoch===ticket.epoch&&current.inFlight&&
    current.expectedOffset===ticket.offset);
 }
 assertCurrent(ticket:DiagnosisTicket):void{
  if(!this.isCurrent(ticket))
   throw new Error('Cancelled or stale CDP diagnosis request revoked');
 }
 complete(ticket:DiagnosisTicket,{pageItems,totalItems}:{pageItems:number;totalItems:number}):void{
  this.assertCurrent(ticket);
  const key=identity(ticket.scanId,ticket.targetId);
  const record=this.active.get(key)!;
  if(!Number.isSafeInteger(totalItems)||totalItems<1||totalItems>1000||
     !Number.isSafeInteger(pageItems)||pageItems!==Math.min(25,totalItems-ticket.offset)||
     (record.totalItems!==null&&record.totalItems!==totalItems))
   throw new Error('Invalid CDP diagnosis page count or batch total');
  const next=ticket.offset+pageItems;
  if(next===totalItems){this.active.delete(key);return;}
  record.expectedOffset=next;
  record.totalItems=totalItems;
  record.inFlight=false;
 }
 cancel({scanId,targetId}:{scanId:string;targetId:string}):void{
  this.active.delete(identity(scanId,targetId));
 }
 invalidateAll():void{this.active.clear();}
 /** A transport-only failure can be retried once by the renderer for the
  * exact same page offset. A late response from the old attempt is never
  * allowed to commit after this lease has been released. */
 releaseForRetry(ticket:DiagnosisTicket):boolean{
  if(!this.isCurrent(ticket))return false;
  const active=this.active.get(identity(ticket.scanId,ticket.targetId))!;
  active.inFlight=false;
  return true;
 }
 /** True only for the exact still-active lease; stale failures cannot
  * corrupt a later restarted batch or change its persisted journal status. */
 failIfCurrent(ticket:DiagnosisTicket):boolean{
  if(!this.isCurrent(ticket))return false;
  this.active.delete(identity(ticket.scanId,ticket.targetId));
  return true;
 }
}
