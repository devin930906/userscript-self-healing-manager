/**
 * Short-lived, Main-process-only approval receipt bound to one static scan.
 * The user must review and apply promptly: old DOM candidates and edit
 * previews must never authorize a much later filesystem write.
 */
export class ProposalApprovalGate{
 private readonly pending=new Map<string,{scanId:string;createdAt:number}>();
 private readonly clock:()=>number;
 private readonly ttlMs:number;
 constructor(options:{now?:()=>number;ttlMs?:number}={}){
  const ttl=options.ttlMs??600_000;
  if(!Number.isSafeInteger(ttl)||ttl<60_000||ttl>1_800_000)
   throw new Error('Invalid repair approval TTL budget');
  if(options.now!==undefined&&typeof options.now!=='function')
   throw new Error('Invalid repair approval clock');
  this.clock=options.now??Date.now;
  this.ttlMs=ttl;
 }
 private getTime():number{
  const now=this.clock();
  if(!Number.isSafeInteger(now)||now<0)
   throw new Error('Invalid repair approval clock');
  return now;
 }
 private expired(created:number,time:number):boolean{
  // Wall-clock rollback is not evidence that the approval remains valid.
  return time<created||time-created>this.ttlMs;
 }
 private purge(time:number):void{
  for(const [key,value] of this.pending){
   if(this.expired(value.createdAt,time))this.pending.delete(key);
  }
 }
 register(proposalId:string,scanId:string):void{
  if(typeof proposalId!=='string'||!proposalId||
     typeof scanId!=='string'||!scanId)
   throw new Error('Invalid repair approval identity');
  const time=this.getTime();
  this.purge(time);
  if(this.pending.has(proposalId))
   throw new Error('Duplicate repair proposal approval registration');
  if(this.pending.size>=100)
   throw new Error('Pending repair proposal limit exceeded');
  this.pending.set(proposalId,{scanId,createdAt:time});
 }
 require(proposalId:string,scanId:string):void{
  const stored=this.pending.get(proposalId);
  if(!stored||typeof scanId!=='string'||!scanId||
     stored.scanId!==scanId)
   throw new Error('Stale repair proposal approval: scan changed or preview is no longer pending');
  const time=this.getTime();
  if(this.expired(stored.createdAt,time)){
   this.pending.delete(proposalId);
   throw new Error('Repair approval expired: generate and review a fresh preview');
  }
 }
 consume(proposalId:string):void{
  this.pending.delete(proposalId);
 }
 clear():void{
  this.pending.clear();
 }
}
