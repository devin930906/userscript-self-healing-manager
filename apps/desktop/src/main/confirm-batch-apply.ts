/** Batch workflow inspectPending does not return proposalId; main owns that lookup key.
 * Compare only fields actually returned by the batch workflow. */
export type BatchProposalSnapshot={scriptId:string;previousHash:string;proposedHash:string;selectorIndexes:readonly number[]};
export function assertBatchProposalSnapshot(expected:BatchProposalSnapshot,current:BatchProposalSnapshot|null|undefined):void{
 if(!current||current.scriptId!==expected.scriptId||
   current.previousHash!==expected.previousHash||
   current.proposedHash!==expected.proposedHash||
   current.selectorIndexes.length!==expected.selectorIndexes.length||
   current.selectorIndexes.some((index,i)=>index!==expected.selectorIndexes[i]))
  throw new Error('Reviewed batch proposal changed during native confirmation');
}
