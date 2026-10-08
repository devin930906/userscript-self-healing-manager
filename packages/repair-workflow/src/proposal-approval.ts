/**
 * Keeps a pending, explicitly reviewed repair proposal tied to its originating
 * static scan. This is a main-process-only approval gate, not a generic
 * permission grant to write scripts.
 */
export class ProposalApprovalGate{
 private readonly pending=new Map<string,string>();
 register(proposalId:string,scanId:string):void{
  if(!proposalId||!scanId)throw new Error('Invalid repair approval identity');
  if(this.pending.has(proposalId))throw new Error('Duplicate repair proposal approval registration');
  if(this.pending.size>=100)throw new Error('Pending repair proposal limit exceeded');
  this.pending.set(proposalId,scanId);
 }
 require(proposalId:string,scanId:string):void{
  if(!proposalId||!scanId||this.pending.get(proposalId)!==scanId)
   throw new Error('Stale repair proposal approval: scan changed or preview is no longer pending');
 }
 consume(proposalId:string):void{
  this.pending.delete(proposalId);
 }
 clear():void{
  this.pending.clear();
 }
}
