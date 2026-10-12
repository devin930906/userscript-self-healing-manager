/** Strict, immutable envelope for explicitly native-reviewed multi-script batches.
 * The renderer may provide only scan/proposal handles, never script paths,
 * source bytes, hashes, functions, browser origins or write authorization.
 * The Main handler MUST still resolve and revalidate each handle itself.
 */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type ReviewedJob={readonly itemIndex:number;readonly proposalId:string};
export type MultiScriptBatchRequest={
 readonly scanId:string;
 readonly approved:true;
 readonly stopOnFailure:boolean;
 readonly jobs:readonly ReviewedJob[];
};
const record=(v:unknown):v is Record<string,unknown>=>
 v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const keys=(v:object)=>Object.keys(v).sort().join(',');

export function parseMultiScriptBatchRequest(input:unknown):MultiScriptBatchRequest{
 if(!record(input)||
    !['approved,jobs,scanId','approved,jobs,scanId,stopOnFailure'].includes(keys(input))||
    input.approved!==true||typeof input.scanId!=='string'||!UUID.test(input.scanId)||
    !Array.isArray(input.jobs)||input.jobs.length<2||input.jobs.length>8||
    (input.stopOnFailure!==undefined&&typeof input.stopOnFailure!=='boolean'))
  throw new Error('Invalid multi-script batch approval envelope');
 const indexes=new Set<number>(),ids=new Set<string>();
 const jobs:ReviewedJob[]=input.jobs.map((raw:unknown)=>{
  if(!record(raw)||keys(raw)!=='itemIndex,proposalId'||
     !Number.isSafeInteger(raw.itemIndex)||Number(raw.itemIndex)<0||
     Number(raw.itemIndex)>100000||
     typeof raw.proposalId!=='string'||!UUID.test(raw.proposalId))
   throw new Error('Invalid multi-script review item');
  const index=Number(raw.itemIndex),id=raw.proposalId.toLowerCase();
  if(indexes.has(index)||ids.has(id))
   throw new Error('Duplicate multi-script approval identity');
  indexes.add(index);ids.add(id);
  return Object.freeze({itemIndex:index,proposalId:id});
 });
 return Object.freeze({
  scanId:input.scanId,approved:true,stopOnFailure:input.stopOnFailure===true,
  jobs:Object.freeze(jobs),
 });
}
