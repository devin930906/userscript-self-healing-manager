import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,link,unlink} from 'node:fs/promises';
import {isAbsolute,dirname,basename,join} from 'node:path';
import type {ScriptHealth} from '../../contracts/src/index.ts';

export type DatabaseErrorCode =
 'DATABASE_BUSY'|'DATABASE_PERMISSION_DENIED'|'DATABASE_INVALID_PATH'|
 'DATABASE_IO_ERROR'|'DATABASE_SCHEMA_UNSUPPORTED'|'DATABASE_UNKNOWN_ERROR';
export class DatabasePersistenceError extends Error {
 readonly code:DatabaseErrorCode;
 readonly rollbackError?:unknown;
 readonly cleanupError?:unknown;
 constructor(code:DatabaseErrorCode,cause:unknown,details?:{rollbackError?:unknown;cleanupError?:unknown}){
  super(cause instanceof Error?cause.message:String(cause),{cause});
  this.name='DatabasePersistenceError';
  this.code=code;
  this.rollbackError=details?.rollbackError;
  this.cleanupError=details?.cleanupError;
 }
}
/** Never infer a native SQLite classification from its free-form message. */
export function classifyDatabaseError(error:unknown,details?:{rollbackError?:unknown;cleanupError?:unknown}):DatabasePersistenceError {
 const native=error && typeof error==='object'?error as {code?:unknown;errcode?:unknown}:null;
 let code:DatabaseErrorCode='DATABASE_UNKNOWN_ERROR';
 if(native?.code==='EACCES'||native?.code==='EPERM')code='DATABASE_PERMISSION_DENIED';
 else if(native?.code==='ENOENT'||native?.code==='ENOTDIR'||native?.code==='EISDIR')code='DATABASE_INVALID_PATH';
 else if(native?.code==='ERR_SQLITE_ERROR'&&typeof native.errcode==='number'){
  switch(native.errcode&255){
   case 5:case 6:code='DATABASE_BUSY';break;
   case 8:code='DATABASE_PERMISSION_DENIED';break;
   case 10:code='DATABASE_IO_ERROR';break;
   case 14:code='DATABASE_INVALID_PATH';break;
  }
 }
 return new DatabasePersistenceError(code,error,details);
}
export interface ScriptRecord {
  id:string; path:string;displayName:string;sha256:string;healthStatus:ScriptHealth;
  metadataJson:string; createdAt:string;updatedAt:string;
}
export type DatabaseHandle=DatabaseSync;
export function openDatabase(path:string):DatabaseHandle{
 let db:DatabaseSync;
 try{db=new DatabaseSync(path);}catch(error){throw classifyDatabaseError(error);}
 try{
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
 }catch(error){
  let cleanupError:unknown;
  try{db.close();}catch(closeError){cleanupError=closeError;}
  throw classifyDatabaseError(error,{cleanupError});
 }
}
/**
 * No version marker means a fresh database only if there is no pre-existing
 * scripts table. A claimed v1 database must have exactly the expected data
 * columns; never silently repair/relabel an unknown schema as version 1.
 */
function assertV1ScriptsTable(db:DatabaseHandle):void{
 const table=db.prepare("SELECT type FROM sqlite_master WHERE name='scripts' LIMIT 1").get() as {type:string}|undefined;
 if(table?.type!=='table')
  throw new Error('Missing or incompatible scripts table for schema version 1');
 const columns=db.prepare('PRAGMA table_info(scripts)').all() as {name:string;type:string;notnull:number;pk:number}[];
 const expected=['id','path','display_name','sha256','health_status','metadata_json','created_at','updated_at'];
 if(columns.length!==expected.length||columns.some((c,i)=>
    c.name!==expected[i]||c.type.toUpperCase()!=='TEXT'||
    (i===0?c.pk!==1:c.pk!==0||c.notnull!==1)))
  throw new Error('Incompatible scripts columns for schema version 1');
 // A marker and matching columns are not enough: without this UNIQUE
 // constraint two IDs may silently refer to the same managed source path.
 // SQLite table-valued PRAGMAs support bound index names, not interpolated SQL.
 const indexes=db.prepare(`SELECT name,"unique" AS isUnique,partial
  FROM pragma_index_list('scripts')`).all() as {name:string;isUnique:number;partial:number}[];
 // index_info() does not expose collation. A NOCASE path UNIQUE would
 // reject distinct case-sensitive source paths despite looking structurally
 // identical to v1. index_xinfo() includes collations and key-column flags.
 const indexColumns=db.prepare('SELECT name,coll,key FROM pragma_index_xinfo(?)');
 const uniqueFields=indexes.map(index=>{
  if(index.isUnique!==1||index.partial!==0)return null;
  const fields=indexColumns.all(index.name) as {name:string|null;coll:string;key:number}[];
  const keyColumns=fields.filter(field=>field.key===1);
  return keyColumns.length===1&&keyColumns[0]?.coll==='BINARY'?keyColumns[0]?.name:null;
 });
 // The v1 table has exactly two BINARY unique constraints: id PRIMARY KEY
 // and path UNIQUE. NOCASE would collapse distinct Unix source paths; an
 // extra UNIQUE index could silently reject otherwise valid imports.
 if(uniqueFields.length!==2||!uniqueFields.includes('id')||!uniqueFields.includes('path'))
  throw new Error('Incompatible scripts schema: unexpected unique index or collation');
 // No triggers belong to the v1 registry schema. A database that otherwise
 // has correct columns and indexes may still carry an unexpected trigger
 // which deletes or rewrites user records on the next normal upsert.
 const unexpectedTrigger=db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('scripts','schema_version') LIMIT 1").get();
 if(unexpectedTrigger)throw new Error('Unsafe SQLite v1 schema: unrecognized mutating trigger');
}
export function migrateDatabase(db:DatabaseHandle):void{
 // Claim a SQLite write transaction BEFORE inspecting or changing the schema.
 // A newer app's Data must never be "partially migrated" by an older binary.
 try{db.exec('BEGIN IMMEDIATE');}catch(error){throw classifyDatabaseError(error);}
 try{
  const marker=db.prepare("SELECT type FROM sqlite_master WHERE name='schema_version' LIMIT 1").get() as {type:string}|undefined;
  const existingScripts=db.prepare("SELECT type FROM sqlite_master WHERE name='scripts' LIMIT 1").get() as {type:string}|undefined;
  if(marker&&marker.type!=='table')
   throw new Error('Invalid database schema version marker');
  if(!marker&&existingScripts)
   throw new Error('Unknown unversioned scripts database: explicit migration required');
  if(marker){
   const versions=db.prepare('SELECT version FROM schema_version LIMIT 2').all();
   if(versions.length!==1||versions[0]?.version!==1)
    throw new Error('Unsupported database schema version; newer or uninitialized Data must not be downgraded');
   assertRegistryV1SnapshotSchema(db);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS scripts(
   id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
   sha256 TEXT NOT NULL, health_status TEXT NOT NULL, metadata_json TEXT NOT NULL,
   created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   INSERT INTO schema_version(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);`);
  const versions=db.prepare('SELECT version FROM schema_version LIMIT 2').all();
  if(versions.length!==1||versions[0]?.version!==1)
   throw new Error('Unsupported database schema version');
  assertRegistryV1SnapshotSchema(db);
  db.exec('COMMIT');
 }catch(error){
  let rollbackError:unknown;
  try{db.exec('ROLLBACK');}catch(cleanupError){rollbackError=cleanupError;}
  // Schema rejection is an explicit version boundary, not a guessed SQLite error.
  const classification=error instanceof Error&&/^(Unsupported database schema version|Unknown unversioned scripts database|Invalid database schema version marker|Missing or incompatible scripts table|Incompatible scripts|Incompatible registry|Invalid registry snapshot|Backup database has an unsupported schema version|Unsafe SQLite v1 schema)/.test(error.message)
   ?'DATABASE_SCHEMA_UNSUPPORTED':undefined;
  throw classification?new DatabasePersistenceError(classification,error,{rollbackError}):classifyDatabaseError(error,{rollbackError});
 }
}
export function createScriptRepository(db:DatabaseHandle){
 const update=db.prepare(`INSERT INTO scripts(id,path,display_name,sha256,health_status,metadata_json,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,
 sha256=excluded.sha256,health_status=excluded.health_status,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
 WHERE scripts.path=excluded.path`);
 const fetch=db.prepare(`SELECT id,path,display_name AS displayName,sha256,health_status AS healthStatus,
 metadata_json AS metadataJson,created_at AS createdAt,updated_at AS updatedAt FROM scripts ORDER BY created_at,id`);
 const findPath=db.prepare('SELECT id FROM scripts WHERE path = ?');
 return {
  upsert(script:ScriptRecord):void{
   // The ID is tied to the original source path; never reassign it to a new
   // source when same-named scripts exist. The SQL WHERE check is atomic.
   const result=update.run(script.id,script.path,script.displayName,script.sha256,script.healthStatus,script.metadataJson,script.createdAt,script.updatedAt);
   if(result.changes!==1)throw new Error('Script ID/path identity conflict: refusing to rebind a source path');
  },
  list():ScriptRecord[]{return fetch.all() as unknown as ScriptRecord[];},
  findIdByPath(path:string):string|undefined{return (findPath.get(path) as {id:string}|undefined)?.id;}
 };
}
export type ScriptRepository=ReturnType<typeof createScriptRepository>;


export interface RegistryBackupReceipt{
 readonly path:string;
 readonly sha256:string;
 readonly bytes:number;
}

/**
 * Refuse a backup whose destination is reached through any linked directory,
 * not only an immediately linked parent. Check root-to-leaf so a junction is
 * noticed before accessing filesystem entries underneath it.
 * This does not replace OS-level directory-handle pinning against races.
 */
async function assertUnlinkedBackupDirectory(directory:string):Promise<void>{
 const components:string[]=[];
 for(let current=directory;;){
  components.push(current);
  const parent=dirname(current);
  if(current===parent)break;
  current=parent;
 }
 for(const component of components.reverse()){
  const info=await lstat(component);
  if(info.isSymbolicLink()||!info.isDirectory())
   throw new Error('Unsafe SQLite backup directory: symlink or non-directory component');
 }
}

/**
 * Take a consistent, committed SQLite registry snapshot while its WAL database
 * remains open. This backs up registry.sqlite ONLY, not the separate diagnosis
 * journal, managed script revisions, browser profiles, or encrypted secrets.
 *
 * The destination must be an explicitly chosen, NEW .sqlite path. A hidden
 * staging file is verified before using an exclusive hard-link publication:
 * no existing target (including symlinks) can ever be overwritten. Filesystems
 * without same-directory hard-link support fail closed.
 */
export async function backupVerifiedSqliteSnapshot(
 db:DatabaseHandle,destination:string,verify:(copy:DatabaseHandle)=>void,
):Promise<RegistryBackupReceipt>{
 if(typeof verify!=='function')throw new Error('Trusted backup verification required');
 if(!(db instanceof DatabaseSync)||typeof destination!=='string'||!isAbsolute(destination)||
    !/\.sqlite$/i.test(destination)||basename(destination).length>200)
  throw new Error('An absolute .sqlite backup destination is required');
 const parent=dirname(destination);
 await assertUnlinkedBackupDirectory(parent);
 try{
  await lstat(destination);
  throw new Error('Backup destination already exists; refusing overwrite');
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
 }
 // Opaque, unpredictable staging name in the SAME destination directory.
 const staging=join(parent,`.usshm-backup-${randomUUID()}.tmp`);
 try{
  // SQLite's backup API includes committed changes still held in the WAL.
  // Raw fs.copyFile of registry.sqlite is never a consistent online snapshot.
  await backup(db,staging);
  // The source can use WAL, but a portable backup must be a standalone
  // main SQLite file. Switch the private snapshot to rollback-journal mode
  // BEFORE hashing/publication; SQLite checkpoints/cleans its own WAL.
  const standalone=new DatabaseSync(staging);
  try{
   const mode=standalone.prepare('PRAGMA journal_mode=DELETE').get() as {journal_mode?:unknown}|undefined;
   if(mode?.journal_mode!=='delete')
    throw new Error('Could not normalize SQLite backup to standalone journal mode');
  }finally{standalone.close();}
  const staged=await lstat(staging);
  if(staged.isSymbolicLink()||!staged.isFile()||staged.size<512||staged.size>512*1024*1024)
   throw new Error('Invalid SQLite backup file size or type');
  const copy=new DatabaseSync(staging,{readOnly:true});
  try{
   const check=copy.prepare('PRAGMA integrity_check').get() as {integrity_check?:unknown}|undefined;
   if(check?.integrity_check!=='ok')throw new Error('SQLite backup integrity check failed');
   verify(copy);
  }finally{copy.close();}
  const digest=createHash('sha256');
  for await(const block of createReadStream(staging))digest.update(block);
  const sha256=digest.digest('hex');
  // Publication is exclusive on both POSIX and Windows. Ordinary rename()
  // could replace an existing backup during a check/write race.
  // A best-effort second guard catches a parent changed after the initial
  // validation; publication itself remains exclusive (no overwrite).
  await assertUnlinkedBackupDirectory(parent);
  await link(staging,destination);
  return Object.freeze({path:destination,sha256,bytes:staged.size});
 }finally{
  // These paths are exclusively owned by the UUID staging snapshot. SQLite
  // sometimes leaves -wal/-shm sidecars after a read-only verification open;
  // they must never leak into completed recovery directories.
  for(const temporary of [staging,staging+'-wal',staging+'-shm']){
   await unlink(temporary).catch((error:NodeJS.ErrnoException)=>{
    if(error.code!=='ENOENT')throw error;
   });
  }
 }
}

/**
 * Validate the entire known v1 registry table layout, constraints and absence
 * of unexpected triggers. A checksum or SQLite integrity_check alone only
 * proves internal consistency, not compatibility or safety for later import.
 * Shared by snapshot publication and independent recovery verification.
 */
export function assertRegistryV1SnapshotSchema(db:DatabaseHandle):void{
 const marker=db.prepare("SELECT type FROM sqlite_master WHERE name='schema_version' LIMIT 1")
  .get() as {type:string}|undefined;
 if(marker?.type!=='table')
  throw new Error('Invalid registry snapshot schema marker');
 const columns=db.prepare('PRAGMA table_info(schema_version)').all() as {
  name:string;type:string;notnull:number;pk:number;
 }[];
 if(columns.length!==1||columns[0]?.name!=='version'||
    columns[0].type.toUpperCase()!=='INTEGER'||columns[0].notnull!==1||
    columns[0].pk!==0||db.prepare('PRAGMA index_list(schema_version)').all().length)
  throw new Error('Incompatible registry schema version marker layout');
 const rows=db.prepare('SELECT version FROM schema_version LIMIT 2').all();
 if(rows.length!==1||rows[0]?.version!==1)
  throw new Error('Backup database has an unsupported schema version');
 assertV1ScriptsTable(db);
}

/** A registry snapshot also requires the exact v1 registry schema. */
export async function backupRegistryDatabase(db:DatabaseHandle,destination:string):Promise<RegistryBackupReceipt>{
 return backupVerifiedSqliteSnapshot(db,destination,assertRegistryV1SnapshotSchema);
}
