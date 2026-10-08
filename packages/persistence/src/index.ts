import {DatabaseSync} from 'node:sqlite';
import type {ScriptHealth} from '../../contracts/src/index.ts';

export interface ScriptRecord {
  id:string; path:string;displayName:string;sha256:string;healthStatus:ScriptHealth;
  metadataJson:string; createdAt:string;updatedAt:string;
}
export type DatabaseHandle=DatabaseSync;
export function openDatabase(path:string):DatabaseHandle{
 const db=new DatabaseSync(path); db.exec('PRAGMA journal_mode = WAL');db.exec('PRAGMA foreign_keys = ON');return db;
}
export function migrateDatabase(db:DatabaseHandle):void{
 db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS scripts(
 id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
 sha256 TEXT NOT NULL, health_status TEXT NOT NULL, metadata_json TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 INSERT INTO schema_version(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
 COMMIT;`);
 if(db.prepare('SELECT MAX(version) AS version FROM schema_version').get()?.version!==1)throw new Error('Unsupported database schema version');
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
