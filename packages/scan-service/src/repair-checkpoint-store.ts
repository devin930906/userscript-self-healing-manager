import {createHash} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {RepairTask,RepairTaskCheckpoint,RepairTaskRow,RepairTaskStatus} from './repair-task-queue.ts';

const CREATE="CREATE TABLE repair_checkpoints(slot INTEGER PRIMARY KEY CHECK(slot=1), payload TEXT NOT NULL)";
const statuses=new Set<RepairTaskStatus>(['queued','running','completed','failed','blocked','cancelled']);
type DiskRow={key:string;status:RepairTaskStatus;attempts:number;errorCode:'TASK_EXECUTION_FAILED'|null};
type DiskState={version:1;rows:DiskRow[]};
const own=(record:object,keys:string):boolean=>Object.keys(record).sort().join(',')===keys;
const digest=(id:string,scriptId:string):string=>
 createHash('sha256').update('USSHM-REPAIR-QUEUE-ID-v1:').update(JSON.stringify([id,scriptId])).digest('hex');
function unsafe():never{throw new Error('Invalid or unsafe repair checkpoint');}
function directoryAndFile(file:string):void{
 if(typeof file!=='string'||!isAbsolute(file)||!file.endsWith('.sqlite')||
    file.length>4096)unsafe();
 const parent=dirname(resolve(file));
 const parts:string[]=[];
 for(let current=parent;;){
  parts.push(current);
  const above=dirname(current);
  if(above===current)break;
  current=above;
 }
 for(const part of parts.reverse()){
  const info=lstatSync(part);
  if(!info.isDirectory()||info.isSymbolicLink())
   throw new Error('Unsafe SQLite checkpoint directory: linked ancestor');
 }
 // SQLite may create or reuse these adjacent files during its first open.
 // Refuse aliases and non-regular entries before SQLite can read or write them.
 // A hard link to another database (or WAL) would otherwise bypass lstat's
 // symlink guard and let us mutate a file outside the intended checkpoint.
 for(const entry of [file,file+'-wal',file+'-shm',file+'-journal']){
  try{
   const info=lstatSync(entry);
   if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
      (entry===file&&info.size>4*1024*1024))
    throw new Error('Unsafe SQLite checkpoint file or sidecar: linked or invalid file');
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  }
 }
}
function validRow(row:unknown,withNames:boolean):row is RepairTaskRow{
 if(!row||typeof row!=='object'||Array.isArray(row))return false;
 const r=row as Record<string,unknown>;
 const expected=withNames?'attempts,errorCode,id,scriptId,status':'attempts,errorCode,key,status';
 if(!own(r,expected)||typeof r.status!=='string'||!statuses.has(r.status as RepairTaskStatus)||
    !Number.isSafeInteger(r.attempts)||Number(r.attempts)<0||Number(r.attempts)>1000000||
    (r.errorCode!==null&&r.errorCode!=='TASK_EXECUTION_FAILED')||
    (r.status==='failed'&&r.errorCode!=='TASK_EXECUTION_FAILED')||
    (r.status!=='failed'&&r.errorCode!==null)||
    (['completed','failed','running'].includes(r.status)&&Number(r.attempts)<1))return false;
 if(withNames)return typeof r.id==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(r.id)&&
  typeof r.scriptId==='string'&&r.scriptId.length>0&&r.scriptId.length<=128;
 return typeof r.key==='string'&&/^[a-f0-9]{64}$/.test(r.key);
}
function encode(checkpoint:RepairTaskCheckpoint):DiskState{
 if(!checkpoint||typeof checkpoint!=='object'||Array.isArray(checkpoint)||
    !own(checkpoint,'items,version')||checkpoint.version!==1||
    !Array.isArray(checkpoint.items)||checkpoint.items.length<1||checkpoint.items.length>1000)unsafe();
 const rows=checkpoint.items.map(row=>{
  if(!validRow(row,true))unsafe();
  return {key:digest(row.id,row.scriptId),status:row.status,
   attempts:row.attempts,errorCode:row.errorCode} as DiskRow;
 });
 if(new Set(rows.map(x=>x.key)).size!==rows.length)unsafe();
 return {version:1,rows};
}
function decode(serialized:unknown):DiskState{
 if(typeof serialized!=='string'||serialized.length<1||serialized.length>300000)unsafe();
 let parsed:unknown;
 try{parsed=JSON.parse(serialized);}catch{unsafe();}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!own(parsed,'rows,version'))unsafe();
 const r=parsed as Record<string,unknown>;
 if(r.version!==1||!Array.isArray(r.rows)||r.rows.length<1||r.rows.length>1000)unsafe();
 const rows:DiskRow[]=[];
 for(const row of r.rows){
  if(!validRow(row,false))unsafe();
  rows.push(row as unknown as DiskRow);
 }
 if(new Set(rows.map(x=>x.key)).size!==rows.length)unsafe();
 return {version:1,rows};
}
/** A durable journal may never turn a finished or abandoned write back into
 * runnable work. The only requeue is an explicit in-process failed-job retry.
 * This is a state-machine check, not authentication of an externally edited DB. */
function assertCheckpointTransition(previous:DiskRow,next:DiskRow):void{
 const allowed:Record<RepairTaskStatus,readonly RepairTaskStatus[]>={
  queued:['queued','running','blocked','cancelled'],
  running:['running','completed','failed','blocked','cancelled'],
  failed:['failed','queued','blocked','cancelled'],
  completed:['completed'],
  blocked:['blocked'],
  cancelled:['cancelled','blocked'],
 };
 if(previous.key!==next.key||!allowed[previous.status].includes(next.status)||
    next.attempts<previous.attempts||
    (next.status===previous.status&&next.attempts!==previous.attempts)||
    (previous.status==='queued'&&next.status==='running'&&next.attempts!==previous.attempts+1)||
    (previous.status==='failed'&&next.status==='queued'&&next.attempts!==previous.attempts)||
    ((previous.status==='running'||previous.status==='failed'||previous.status==='cancelled')&&
     next.attempts!==previous.attempts))
  throw new Error('Unsafe repair checkpoint state transition');
}
function assertSchema(db:DatabaseSync):void{
 const v=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
 if(v!==1)throw new Error('Unsupported repair checkpoint SQLite schema version');
 const objects=db.prepare("SELECT name,type,sql FROM sqlite_master WHERE substr(lower(name),1,7) <> 'sqlite_'").all() as
  {name:string;type:string;sql:string|null}[];
 if(objects.length!==1||objects[0]?.type!=='table'||objects[0].name!=='repair_checkpoints'||
    objects[0].sql!==CREATE)
  throw new Error('Unsafe repair checkpoint SQLite schema or trigger');
 const table=db.prepare("SELECT wr,strict FROM pragma_table_list WHERE schema='main' AND name='repair_checkpoints'")
  .get() as {wr:number;strict:number}|undefined;
 if(!table||table.wr!==0||table.strict!==0)
  throw new Error('Unsafe repair checkpoint table layout');
 const cols=db.prepare('PRAGMA table_xinfo(repair_checkpoints)').all() as
  {name:string;type:string;notnull:number;pk:number;hidden:number}[];
 if(cols.length!==2||cols[0]?.name!=='slot'||cols[0].type!=='INTEGER'||cols[0].pk!==1||
    cols[0].hidden!==0||cols[1]?.name!=='payload'||cols[1].type!=='TEXT'||
    cols[1].notnull!==1||cols[1].pk!==0||cols[1].hidden!==0)
  throw new Error('Unsafe repair checkpoint columns');
}
/**
 * Local-only, separate, transactionally committed repair queue checkpoint.
 * The DB stores only one strictly matched queue and opaque SHA-256 identities,
 * not raw script names, source paths, permissions, callbacks, or error text.
 * This is NOT a complete Windows power-loss or cross-process lock certification.
 */
export function openRepairCheckpointStore(file:string){
 directoryAndFile(file);
 const db=new DatabaseSync(file);
 let closed=false;
 try{
  const version=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
  if(version===0){
   const existing=db.prepare("SELECT name FROM sqlite_master WHERE substr(lower(name),1,7) <> 'sqlite_' LIMIT 1").get();
   if(existing)throw new Error('Unsafe unversioned repair checkpoint SQLite schema');
   db.exec('BEGIN IMMEDIATE');
   try{
    db.exec(CREATE);
    db.exec('PRAGMA user_version=1');
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
  assertSchema(db);
  db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;');
 }catch(error){db.close();throw error;}
 const get=db.prepare('SELECT payload FROM repair_checkpoints WHERE slot=1');
 const put=db.prepare('INSERT INTO repair_checkpoints(slot,payload) VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload');
 const requireOpen=()=>{if(closed)throw new Error('Repair checkpoint store is closed');};
 return {
  async save(checkpoint:RepairTaskCheckpoint):Promise<void>{
   requireOpen();
   const state=encode(checkpoint);
   const serialized=JSON.stringify(state);
   if(serialized.length>300000)unsafe();
   db.exec('BEGIN IMMEDIATE');
   try{
    const previous=get.get() as {payload:unknown}|undefined;
    if(previous){
     const old=decode(previous.payload);
     if(old.rows.length!==state.rows.length||
        old.rows.some((row,i)=>row.key!==state.rows[i]!.key))
      throw new Error('Repair checkpoint task identity mismatch');
     for(let i=0;i<old.rows.length;i++)
      assertCheckpointTransition(old.rows[i]!,state.rows[i]!);
    }
    put.run(serialized);
    db.exec('COMMIT');
   }catch(error){
    try{db.exec('ROLLBACK');}catch{}
    throw error;
   }
  },
  load(tasks:readonly Pick<RepairTask,'id'|'scriptId'>[]):RepairTaskCheckpoint|undefined{
   requireOpen();
   if(!Array.isArray(tasks)||tasks.length<1||tasks.length>1000)unsafe();
   const row=get.get() as {payload:unknown}|undefined;
   if(!row)return undefined;
   const state=decode(row.payload);
   if(state.rows.length!==tasks.length)throw new Error('Repair checkpoint task identity mismatch');
   const restored:RepairTaskRow[]=state.rows.map((record,i)=>{
    const task=tasks[i];
    if(!task||typeof task.id!=='string'||typeof task.scriptId!=='string'||
       record.key!==digest(task.id,task.scriptId))
     throw new Error('Repair checkpoint task identity mismatch');
    return Object.freeze({id:task.id,scriptId:task.scriptId,
     status:record.status,attempts:record.attempts,errorCode:record.errorCode});
   });
   return Object.freeze({version:1,items:Object.freeze(restored)});
  },
  close():void{
   if(closed)return;
   closed=true;db.close();
  },
 };
}


/** Read-only recovery triage after desktop restart.
 * No repair identities, script bytes, paths, approval handles or exception
 * messages leave this function. Never execute or restore a pending task.
 * Missing/incomplete/corrupt journals fail closed for the caller to flag.
 */
export function readRepairCheckpointSummary(file:string):{
 total:number;completed:number;needsReview:number;uncertain:number;
}{
 directoryAndFile(file);
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  assertSchema(db);
  const raw=db.prepare('SELECT payload FROM repair_checkpoints WHERE slot=1').get() as
   {payload:unknown}|undefined;
  if(!raw)throw new Error('Incomplete repair checkpoint; fresh review required');
  const state=decode(raw.payload);
  const rows=state.rows;
  return Object.freeze({
   total:rows.length,
   completed:rows.filter(row=>row.status==='completed').length,
   needsReview:rows.filter(row=>row.status!=='completed').length,
   uncertain:rows.filter(row=>row.status==='running').length,
  });
 }finally{db.close();}
}
