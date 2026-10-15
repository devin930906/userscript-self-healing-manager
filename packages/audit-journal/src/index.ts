import {isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {parseAuditTrace,type AuditTrace} from '../../contracts/src/audit-trace.ts';

type SqlRow=Record<string,string>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256=/^[0-9a-f]{64}$/;
const canonicalTimestamp=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const tableColumns=Object.freeze({
 audit_jobs:['id','script_id','attempt_id','source_sha256'],
 audit_findings:['id','job_id','script_id','attempt_id'],
 audit_candidates:['id','finding_id','job_id'],
 audit_tests:['id','candidate_id','job_id','status'],
 audit_approvals:['id','test_id','candidate_id','job_id','source_sha256','expires_at'],
 audit_revisions:['id','approval_id','candidate_id','job_id','script_id','source_sha256','revision_sha256'],
} as const);

function assertSchema(db:DatabaseSync):void{
 const version=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
 if(version!==1)throw new Error('Unsupported audit journal schema version');
 for(const [table,expected] of Object.entries(tableColumns)){
  const type=db.prepare("SELECT type FROM sqlite_master WHERE name=? LIMIT 1").get(table) as {type?:string}|undefined;
  if(type?.type!=='table')throw new Error('Missing audit journal schema table');
  const actual=(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).map(x=>x.name);
  if(actual.length!==expected.length||actual.some((name,index)=>name!==expected[index]))
   throw new Error('Incompatible audit journal schema columns');
  for(const suffix of ['no_update','no_delete'] as const){
   const operation=suffix==='no_update'?'UPDATE':'DELETE';
   const expectedSql=`CREATE TRIGGER ${table}_${suffix} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'audit journal is append-only'); END`;
   const trigger=db.prepare("SELECT type,sql FROM sqlite_master WHERE type='trigger' AND name=? LIMIT 1")
    .get(table+'_'+suffix) as {type?:string;sql?:string}|undefined;
   const normalize=(sql:string):string=>sql.replace(/\\s+/g,' ').trim().replace(/;$/,'');
   if(trigger?.type!=='trigger'||typeof trigger.sql!=='string'||
      normalize(trigger.sql)!==normalize(expectedSql))
    throw new Error('Missing or incompatible append-only audit journal trigger');
  }
 }
 const check=db.prepare('PRAGMA quick_check').get() as Record<string,unknown>|undefined;
 if(!check||Object.values(check)[0]!=='ok')throw new Error('Audit journal SQLite integrity check failed');
}
function freezeTrace(row:SqlRow):AuditTrace{
 const job=Object.freeze({id:row.job_id!,scriptId:row.script_id!,attemptId:row.attempt_id!,sourceSha256:row.source_sha256!});
 const finding=Object.freeze({id:row.finding_id!,jobId:row.job_id!,scriptId:row.script_id!,attemptId:row.attempt_id!});
 const candidate=Object.freeze({id:row.candidate_id!,findingId:row.finding_id!,jobId:row.job_id!});
 const test=Object.freeze({id:row.test_id!,candidateId:row.candidate_id!,jobId:row.job_id!,status:'passed' as const});
 const approval=Object.freeze({id:row.approval_id!,testId:row.test_id!,candidateId:row.candidate_id!,jobId:row.job_id!,sourceSha256:row.source_sha256!,expiresAt:row.expires_at!});
 const revision=Object.freeze({id:row.revision_id!,approvalId:row.approval_id!,candidateId:row.candidate_id!,jobId:row.job_id!,scriptId:row.script_id!,sourceSha256:row.source_sha256!,revisionSha256:row.revision_sha256!});
 return Object.freeze({job,finding,candidate,test,approval,revision}) as AuditTrace;
}

/**
 * Local append-only FR-041 evidence journal.
 *
 * It stores only bounded identifiers, SHA-256 values and approval expiry.
 * No userscript source, DOM, URL, browser profile, credential or exception text
 * is accepted. A repeated historical entity may be referenced by a later trace
 * only when its immutable fields match byte-for-byte.
 */
export function openAuditJournal(file:string){
 if(typeof file!=='string'||!isAbsolute(file))throw new Error('Audit journal path must be absolute');
 const db=new DatabaseSync(file);
 try{
  const version=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
  if(version!==0&&version!==1)throw new Error('Unsupported audit journal schema version');
  db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;');
  if(version===0){
   db.exec(`
BEGIN IMMEDIATE;
CREATE TABLE audit_jobs (
 id TEXT PRIMARY KEY,script_id TEXT NOT NULL,attempt_id TEXT NOT NULL,source_sha256 TEXT NOT NULL
);
CREATE TABLE audit_findings (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES audit_jobs(id),script_id TEXT NOT NULL,attempt_id TEXT NOT NULL
);
CREATE TABLE audit_candidates (
 id TEXT PRIMARY KEY,finding_id TEXT NOT NULL REFERENCES audit_findings(id),job_id TEXT NOT NULL REFERENCES audit_jobs(id)
);
CREATE TABLE audit_tests (
 id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL REFERENCES audit_candidates(id),job_id TEXT NOT NULL REFERENCES audit_jobs(id),
 status TEXT NOT NULL CHECK(status='passed')
);
CREATE TABLE audit_approvals (
 id TEXT PRIMARY KEY,test_id TEXT NOT NULL REFERENCES audit_tests(id),candidate_id TEXT NOT NULL REFERENCES audit_candidates(id),
 job_id TEXT NOT NULL REFERENCES audit_jobs(id),source_sha256 TEXT NOT NULL,expires_at TEXT NOT NULL
);
CREATE TABLE audit_revisions (
 id TEXT PRIMARY KEY,approval_id TEXT NOT NULL REFERENCES audit_approvals(id),candidate_id TEXT NOT NULL REFERENCES audit_candidates(id),
 job_id TEXT NOT NULL REFERENCES audit_jobs(id),script_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,revision_sha256 TEXT NOT NULL
);
`+
Object.keys(tableColumns).flatMap(table=>[
 `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'audit journal is append-only'); END;`,
 `CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'audit journal is append-only'); END;`,
]).join('\n')+
`
PRAGMA user_version=1;
COMMIT;`);
  }
  assertSchema(db);
 }catch(error){try{db.exec('ROLLBACK');}catch{}db.close();throw error;}

 const jobInsert=db.prepare('INSERT INTO audit_jobs(id,script_id,attempt_id,source_sha256) VALUES(?,?,?,?)');
 const findingInsert=db.prepare('INSERT INTO audit_findings(id,job_id,script_id,attempt_id) VALUES(?,?,?,?)');
 const candidateInsert=db.prepare('INSERT INTO audit_candidates(id,finding_id,job_id) VALUES(?,?,?)');
 const testInsert=db.prepare("INSERT INTO audit_tests(id,candidate_id,job_id,status) VALUES(?,?,?,'passed')");
 const approvalInsert=db.prepare('INSERT INTO audit_approvals(id,test_id,candidate_id,job_id,source_sha256,expires_at) VALUES(?,?,?,?,?,?)');
 const revisionInsert=db.prepare('INSERT INTO audit_revisions(id,approval_id,candidate_id,job_id,script_id,source_sha256,revision_sha256) VALUES(?,?,?,?,?,?,?)');
 const revisionPresent=db.prepare('SELECT 1 AS present FROM audit_revisions WHERE id=?');
 const managedRevisionIds=db.prepare('SELECT id FROM audit_revisions WHERE script_id=? AND revision_sha256=? ORDER BY id LIMIT 2');
 const byRevision=db.prepare(`
SELECT r.id AS revision_id,r.revision_sha256,r.source_sha256,r.script_id,r.job_id,
 j.attempt_id,f.id AS finding_id,c.id AS candidate_id,t.id AS test_id,
 a.id AS approval_id,a.expires_at
FROM audit_revisions r
JOIN audit_jobs j ON j.id=r.job_id AND j.script_id=r.script_id AND j.source_sha256=r.source_sha256
JOIN audit_findings f ON f.job_id=j.id AND f.script_id=j.script_id AND f.attempt_id=j.attempt_id
JOIN audit_candidates c ON c.id=r.candidate_id AND c.finding_id=f.id AND c.job_id=j.id
JOIN audit_tests t ON t.candidate_id=c.id AND t.job_id=j.id AND t.status='passed'
JOIN audit_approvals a ON a.id=r.approval_id AND a.test_id=t.id AND a.candidate_id=c.id AND a.job_id=j.id
 AND a.source_sha256=r.source_sha256
WHERE r.id=?
`);
 const stageIdLookups=new Map(Object.keys(tableColumns).map(table=>
  [table,db.prepare(`SELECT 1 AS present FROM ${table} WHERE id=?`)] as const));
 const assertEntityStage=(expectedTable:string,id:string):void=>{
  for(const [table,query] of stageIdLookups){
   if(table!==expectedTable&&query.get(id))
    throw new Error('Audit entity ID already belongs to a different stage');
  }
 };

 const exact=(table:string,id:string,fields:readonly string[],values:readonly string[]):boolean=>{
  const columns=['id',...fields];
  const row=db.prepare(`SELECT ${columns.join(',')} FROM ${table} WHERE id=?`).get(id) as SqlRow|undefined;
  if(!row)return false;
  if(columns.some((column,index)=>row[column]!==[id,...values][index]))
   throw new Error('Immutable audit entity conflict');
  return true;
 };
 const insertOrVerify=(table:string,id:string,fields:readonly string[],values:readonly string[],insert:()=>void):void=>{
  if(exact(table,id,fields,values))return;
  insert();
 };

 const getByRevision=(revisionId:string):AuditTrace|null=>{
   if(typeof revisionId!=='string'||!uuid.test(revisionId))
    throw new Error('Invalid canonical audit revision id');
   if(!revisionPresent.get(revisionId))return null;
   const row=byRevision.get(revisionId) as SqlRow|undefined;
   if(!row)throw new Error('Corrupt audit journal chain');
   for(const key of ['revision_id','job_id','finding_id','candidate_id','test_id','approval_id','script_id','attempt_id'] as const)
    if(!uuid.test(row[key]??''))throw new Error('Corrupt audit journal identity');
   const persistedEntityIds=['revision_id','job_id','finding_id','candidate_id','test_id','approval_id']
    .map(key=>row[key]??'');
   if(new Set(persistedEntityIds).size!==persistedEntityIds.length)
    throw new Error('Corrupt audit journal duplicate entity identity');
   for(const key of ['source_sha256','revision_sha256'] as const)
    if(!sha256.test(row[key]??''))throw new Error('Corrupt audit journal hash');
   const expiry=row.expires_at??'';
   const parsedExpiry=Date.parse(expiry);
   if(!canonicalTimestamp.test(expiry)||!Number.isFinite(parsedExpiry)||
      new Date(parsedExpiry).toISOString()!==expiry)
    throw new Error('Corrupt audit journal approval expiry');
   return freezeTrace(row);

 };

 return Object.freeze({
  append(input:unknown,now:string):Readonly<{revisionId:string;jobId:string;revisionSha256:string}>{
   const trace=parseAuditTrace(input,now);
   if(db.prepare('SELECT 1 AS present FROM audit_revisions WHERE id=?').get(trace.revision.id))
    throw new Error('Duplicate immutable audit revision');
   try{
    db.exec('BEGIN IMMEDIATE');
    for(const [table,id] of [
     ['audit_jobs',trace.job.id],['audit_findings',trace.finding.id],['audit_candidates',trace.candidate.id],
     ['audit_tests',trace.test.id],['audit_approvals',trace.approval.id],['audit_revisions',trace.revision.id],
    ] as const)assertEntityStage(table,id);
    insertOrVerify('audit_jobs',trace.job.id,['script_id','attempt_id','source_sha256'],
     [trace.job.scriptId,trace.job.attemptId,trace.job.sourceSha256],
     ()=>{jobInsert.run(trace.job.id,trace.job.scriptId,trace.job.attemptId,trace.job.sourceSha256);});
    insertOrVerify('audit_findings',trace.finding.id,['job_id','script_id','attempt_id'],
     [trace.finding.jobId,trace.finding.scriptId,trace.finding.attemptId],
     ()=>{findingInsert.run(trace.finding.id,trace.finding.jobId,trace.finding.scriptId,trace.finding.attemptId);});
    insertOrVerify('audit_candidates',trace.candidate.id,['finding_id','job_id'],
     [trace.candidate.findingId,trace.candidate.jobId],
     ()=>{candidateInsert.run(trace.candidate.id,trace.candidate.findingId,trace.candidate.jobId);});
    insertOrVerify('audit_tests',trace.test.id,['candidate_id','job_id','status'],
     [trace.test.candidateId,trace.test.jobId,'passed'],
     ()=>{testInsert.run(trace.test.id,trace.test.candidateId,trace.test.jobId);});
    insertOrVerify('audit_approvals',trace.approval.id,['test_id','candidate_id','job_id','source_sha256','expires_at'],
     [trace.approval.testId,trace.approval.candidateId,trace.approval.jobId,trace.approval.sourceSha256,trace.approval.expiresAt],
     ()=>{approvalInsert.run(trace.approval.id,trace.approval.testId,trace.approval.candidateId,trace.approval.jobId,trace.approval.sourceSha256,trace.approval.expiresAt);});
    revisionInsert.run(trace.revision.id,trace.revision.approvalId,trace.revision.candidateId,trace.revision.jobId,
     trace.revision.scriptId,trace.revision.sourceSha256,trace.revision.revisionSha256);
    db.exec('COMMIT');
   }catch(error){
    try{db.exec('ROLLBACK');}catch{}
    if(error instanceof Error&&(/constraint/i.test(error.message)||/immutable audit entity conflict/i.test(error.message)))
     throw new Error('Duplicate or immutable audit entity conflict');
    throw error;
   }
   return Object.freeze({revisionId:trace.revision.id,jobId:trace.job.id,revisionSha256:trace.revision.revisionSha256});
  },
  getByRevision,
  getByManagedRevision(input:{scriptId:string;revisionSha256:string}):AuditTrace|null{
   if(!input||typeof input!=='object'||!uuid.test(input.scriptId)||!sha256.test(input.revisionSha256))
    throw new Error('Invalid managed audit revision identity');
   const rows=managedRevisionIds.all(input.scriptId,input.revisionSha256) as Array<{id?:string}>;
   if(rows.length>1)throw new Error('Ambiguous managed audit revision history');
   const revisionId=rows[0]?.id;
   if(!revisionId)return null;
   return getByRevision(revisionId);
  },
  close():void{db.close();},
 });
}
export type AuditJournal=ReturnType<typeof openAuditJournal>;
