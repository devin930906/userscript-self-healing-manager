import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

/**
 * Synchronous Main-process and cross-process singleflight for the same
 * managed-script source. SQLite BEGIN IMMEDIATE holds an OS-backed writer
 * lock for each script. A terminated process releases the DB connection/lock
 * via the OS, unlike a crash-orphaned PID/lockfile convention.
 *
 * Only managed revision writes are serialized; userscript source files are
 * never opened or executed. No renderer-provided approval is accepted here.
 * This is one safety layer, NOT complete independent Windows release QA.
 */
const activeManagedScripts=new Set<string>();
const SCRIPT=/^[A-Za-z0-9_-]{1,64}$/;
const MAX_ITEMS=64;
const MAX_PATH=4096;
function safeAncestors(directory:string):void{
 for(let current=resolve(directory);;current=dirname(current)){
  const info=lstatSync(current);
  if(!info.isDirectory()||info.isSymbolicLink())
   throw new Error('Unsafe managed write lease directory');
  const parent=dirname(current);
  if(parent===current)return;
 }
}
function safeLeaseFile(file:string):void{
 for(const p of [file,file+'-journal',file+'-wal',file+'-shm']){
  try{
   const info=lstatSync(p);
   // The Main write lease itself holds only a tiny SQLite transaction.
   // Bound even existing WAL/SHM/journal files before allowing SQLite open.
   const maxBytes=p===file?4*1024*1024:64*1024*1024;
   if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
      !Number.isSafeInteger(info.size)||info.size>maxBytes)
    throw new Error('Unsafe managed write lease file or SQLite sidecar');
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  }
 }
}
function releaseDatabases(databases:DatabaseSync[]):void{
 for(const db of databases.reverse()){
  try{db.exec('ROLLBACK');}catch{}
  // Regardless of a rollback exception, try to close the connection so
  // Windows frees its kernel-enforced SQLite writer lock.
  try{db.close();}catch{}
 }
}

/**
 * Reserve an entire freshly reviewed set before any asynchronous code yields.
 * Per-script hashed SQLite filenames prevent raw script IDs from appearing
 * in lock filenames. Existing lock DBs are harmless and deliberately kept:
 * their transactions, not a permanent file's existence, signify ownership.
 *
 * Separate scripts use separate SQLite locks, preserving error isolation.
 * No stale authorization can be reconstructed or replayed from a lock DB.
 */
export function reserveManagedScriptWrites(dataRoot:string,scriptIds:readonly string[]):()=>void{
 if(typeof dataRoot!=='string'||!isAbsolute(dataRoot)||dataRoot.length>MAX_PATH||
    !Array.isArray(scriptIds)||scriptIds.length<1||scriptIds.length>MAX_ITEMS||
    scriptIds.some(id=>typeof id!=='string'||!SCRIPT.test(id)))
  throw new Error('Invalid managed script lease identity');
 const normalizedRoot=resolve(dataRoot);
 const rootKey=process.platform==='win32'?normalizedRoot.toLowerCase():normalizedRoot;
 const keys=scriptIds.map(id=>rootKey+'\u0000'+id.toLowerCase());
 if(new Set(keys).size!==keys.length)
  throw new Error('Duplicate managed script lease identity');
 if(keys.some(key=>activeManagedScripts.has(key)))
  throw new Error('Concurrent managed script repair already active');
 for(const key of keys)activeManagedScripts.add(key);
 const connections:DatabaseSync[]=[];
 const release=()=>{
  releaseDatabases(connections);
  for(const key of keys)activeManagedScripts.delete(key);
 };
 try{
  safeAncestors(normalizedRoot);
  const lockDirectory=join(normalizedRoot,'managed-write-locks');
  mkdirSync(lockDirectory,{recursive:true});
  safeAncestors(lockDirectory);
  // Deterministic order for overlapping groups. Never block another writer
  // awaiting consent: contention must fail closed, not silently wait/retry.
  const names=[...new Set(scriptIds.map(id=>id.toLowerCase()))].sort();
  for(const id of names){
   const filename=createHash('sha256').update('USSHM-MANAGED-WRITE-LEASE-v1:')
    .update(id).digest('hex')+'.sqlite';
   const file=join(lockDirectory,filename);
   safeLeaseFile(file);
   let db:DatabaseSync|undefined;
   try{
    db=new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout=0;');
    db.exec('BEGIN IMMEDIATE;');
    connections.push(db);
    db=undefined;
   }finally{
    if(db)try{db.close();}catch{}
   }
  }
 }catch{
  release();
  // Never include SQLite errors or the absolute Data path in UI/log output.
  throw new Error('Concurrent or unsafe managed script write; fresh review required');
 }
 let released=false;
 return ()=>{
  if(released)return;
  released=true;
  release();
 };
}
