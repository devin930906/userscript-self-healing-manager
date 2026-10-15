/** FR-041: validate a caller-supplied, already-loaded audit snapshot.
 * This validates relationships, not database existence, authenticity or authorization. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/;
const fields = Object.freeze({
 job:['id','scriptId','attemptId','sourceSha256'],
 finding:['id','jobId','scriptId','attemptId'],
 candidate:['id','findingId','jobId'],
 test:['id','candidateId','jobId','status'],
 approval:['id','testId','candidateId','jobId','sourceSha256','expiresAt'],
 revision:['id','approvalId','candidateId','jobId','scriptId','sourceSha256','revisionSha256'],
} as const);
export type AuditTrace = Readonly<{[K in keyof typeof fields]:Readonly<Record<(typeof fields)[K][number],string>>}> & {readonly test:Readonly<{id:string;candidateId:string;jobId:string;status:'passed'}>};
/** Read only an own, enumerable data property. Never invoke untrusted
 * accessor getters while validating a caller-supplied audit snapshot. */
function ownDataProperty(value:Record<string,unknown>,key:string,label:string):unknown{
 const descriptor=Object.getOwnPropertyDescriptor(value,key);
 if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))
  throw new TypeError('Invalid '+label+' data property');
 return descriptor.value;
}
function record<K extends string>(input:unknown,keys:readonly K[],label:string):Record<K,string>{
 if(!input||typeof input!=='object'||Array.isArray(input)||
  (Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null))
  throw new TypeError('Invalid '+label);
 const value=input as Record<string,unknown>;
 if(Reflect.ownKeys(value).length!==keys.length||!keys.every(k=>Object.hasOwn(value,k)))
  throw new TypeError('Invalid '+label+' fields');
 const out:Record<string,string>=Object.create(null);
 for(const key of keys){
  const field=ownDataProperty(value,key,label+'.'+key);
  if(typeof field!=='string')throw new TypeError('Invalid '+label+'.'+key);
  out[key]=field;
  if(key==='id'||key.endsWith('Id')){
   if(!uuid.test(out[key]))throw new TypeError('Invalid '+label+'.'+key);
  }
 }
 return Object.freeze(out) as Record<K,string>;
}
function requireSame(actual:string,expected:string):void{
 if(actual!==expected)throw new TypeError('Audit trace reference mismatch');
}
/** now is supplied by a trusted caller; expiry is exclusive. */
export function parseAuditTrace(input:unknown,now:string):AuditTrace{
 if(!input||typeof input!=='object'||Array.isArray(input)||
  (Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null))
  throw new TypeError('Invalid audit trace');
 const value=input as Record<string,unknown>;
 const names=Object.keys(fields) as (keyof typeof fields)[];
 if(Reflect.ownKeys(value).length!==names.length||!names.every(k=>Object.hasOwn(value,k)))
  throw new TypeError('Incomplete audit trace');
 const out={} as {-readonly [K in keyof typeof fields]:Record<(typeof fields)[K][number],string>};
 for(const stage of names){(out as Record<string,unknown>)[stage]=record(ownDataProperty(value,stage,'audit trace.'+stage),fields[stage],stage);}
 const {job,finding,candidate,test,approval,revision}=out;
 const entityIds=names.map(stage=>out[stage].id.toLowerCase());
 if(new Set(entityIds).size!==entityIds.length)throw new TypeError('Audit trace entity IDs must be distinct');
 for(const stage of names){
  const row=out[stage] as Record<string,string>;
  for(const key of fields[stage])if((key==='id'||key.endsWith('Id'))&&row[key]!==row[key]!.toLowerCase())
   throw new TypeError('Audit UUID identities must use canonical lowercase');
 }
 for(const stage of [finding,candidate,test,approval,revision])requireSame(stage.jobId,job.id);
 requireSame(finding.scriptId,job.scriptId);
 requireSame(finding.attemptId,job.attemptId);
 requireSame(candidate.findingId,finding.id);
 requireSame(test.candidateId,candidate.id);
 requireSame(approval.testId,test.id);
 requireSame(approval.candidateId,candidate.id);
 requireSame(revision.approvalId,approval.id);
 requireSame(revision.candidateId,candidate.id);
 requireSame(revision.scriptId,job.scriptId);
 if(!sha256.test(job.sourceSha256))throw new TypeError('Invalid pinned source hash');
 requireSame(approval.sourceSha256,job.sourceSha256);
 requireSame(revision.sourceSha256,job.sourceSha256);
 if(!sha256.test(revision.revisionSha256))throw new TypeError('Invalid revision SHA-256 hash');
 if(test.status!=='passed')throw new TypeError('Test did not pass');
 const canonical=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
 const parsedNow=Date.parse(now),expiry=Date.parse(approval.expiresAt);
 if(!canonical.test(now)||!canonical.test(approval.expiresAt)||
  !Number.isFinite(parsedNow)||!Number.isFinite(expiry)||
  new Date(parsedNow).toISOString()!==now||
  new Date(expiry).toISOString()!==approval.expiresAt||parsedNow>=expiry)
  throw new TypeError('Invalid or expired approval window');
 return Object.freeze(out) as AuditTrace;
}
