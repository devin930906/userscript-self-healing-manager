import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,link,unlink} from 'node:fs/promises';
import {isAbsolute,dirname,basename,join} from 'node:path';
import type {ScriptHealth} from '../../contracts/src/index.ts';

export interface ScriptRecord {
  id:string; path:string;displayName:string;sha256:string;healthStatus:ScriptHealth;
  metadataJson:string; createdAt:string;updatedAt:string;
}
export type DatabaseHandle=DatabaseSync;
export function openDatabase(path:string):DatabaseHandle{
 const db=new DatabaseSync(path); db.exec('PRAGMA journal_mode = WAL');db.exec('PRAGMA foreign_keys = ON');return db;
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
 const indexColumns=db.prepare('SELECT name FROM pragma_index_info(?)');
 const pathUnique=indexes.some(index=>{
  if(index.isUnique!==1||index.partial!==0)return false;
  const fields=indexColumns.all(index.name) as {name:string|null}[];
  return fields.length===1&&fields[0]?.name==='path';
 });
 if(!pathUnique)
  throw new Error('Incompatible scripts schema: missing unique path constraint');
}
export function migrateDatabase(db:DatabaseHandle):void{
 // Claim a SQLite write transaction BEFORE inspecting or changing the schema.
 // A newer app's Data must never be "partially migrated" by an older binary.
 db.exec('BEGIN IMMEDIATE');
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
   assertV1ScriptsTable(db);
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
  assertV1ScriptsTable(db);
  db.exec('COMMIT');
 }catch(error){
  db.exec('ROLLBACK');
  throw error;
 }
}
export function createScriptRepository(db:DatabaseHandle){
 const update=db.prepare(`INSERT INTO scripts(id,path,display_name,sha256,health_status,metadata_json,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,display_name=excluded.display_name,
 sha256=excluded.sha256,health_status=excluded.health_status,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`);
 const fetch=db.prepare(`SELECT id,path,display_name AS displayName,sha256,health_status AS healthStatus,
 metadata_json AS metadataJson,created_at AS createdAt,updated_at AS updatedAt FROM scripts ORDER BY created_at,id`);
 const findPath=db.prepare('SELECT id FROM scripts WHERE path = ?');
 return {
  upsert(script:ScriptRecord):void{update.run(script.id,script.path,script.displayName,script.sha256,script.healthStatus,script.metadataJson,script.createdAt,script.updatedAt);},
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
 * Take a consistent, committed SQLite registry snapshot while its WAL database
 * remains open. This backs up registry.sqlite ONLY, not the separate diagnosis
 * journal, managed script revisions, browser profiles, or encrypted secrets.
 *
 * The destination must be an explicitly chosen, NEW .sqlite path. A hidden
 * staging file is verified before using an exclusive hard-link publication:
 * no existing target (including symlinks) can ever be overwritten. Filesystems
 * without same-directory hard-link support fail closed.
 */
export async function backupRegistryDatabase(db:DatabaseHandle,destination:string):Promise<RegistryBackupReceipt>{
 if(!(db instanceof DatabaseSync)||typeof destination!=='string'||!isAbsolute(destination)||
    !/\.sqlite$/i.test(destination)||basename(destination).length>200)
  throw new Error('An absolute .sqlite backup destination is required');
 const parent=dirname(destination);
 const parentInfo=await lstat(parent);
 if(!parentInfo.isDirectory()||parentInfo.isSymbolicLink())
  throw new Error('Unsafe SQLite backup parent directory');
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
  const staged=await lstat(staging);
  if(staged.isSymbolicLink()||!staged.isFile()||staged.size<512||staged.size>512*1024*1024)
   throw new Error('Invalid SQLite backup file size or type');
  const copy=new DatabaseSync(staging,{readOnly:true});
  try{
   const check=copy.prepare('PRAGMA integrity_check').get() as {integrity_check?:unknown}|undefined;
   if(check?.integrity_check!=='ok')throw new Error('SQLite backup integrity check failed');
   const rows=copy.prepare('SELECT version FROM schema_version LIMIT 2').all();
   if(rows.length!==1||rows[0]?.version!==1)
    throw new Error('Backup database has an unsupported schema version');
   assertV1ScriptsTable(copy);
  }finally{copy.close();}
  const digest=createHash('sha256');
  for await(const block of createReadStream(staging))digest.update(block);
  const sha256=digest.digest('hex');
  // Publication is exclusive on both POSIX and Windows. Ordinary rename()
  // could replace an existing backup during a check/write race.
  await link(staging,destination);
  return Object.freeze({path:destination,sha256,bytes:staged.size});
 }finally{
  await unlink(staging).catch((error:NodeJS.ErrnoException)=>{
   if(error.code!=='ENOENT')throw error;
  });
 }
}
