import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile,lstat,readdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {commitManagedCurrent} from '../src/current-activation.ts';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(run:(dir:string,path:string)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'usshm-current-transaction-'));
 try{await run(dir,join(dir,'current.user.js'));}
 finally{await rm(dir,{recursive:true,force:true});}
}

test('restoring a revision stages and verifies bytes without exposing a partial current',async()=>fixture(async(dir,path)=>{
 const bytes=Buffer.alloc(160000,0x67);
 let writes=0;
 await commitManagedCurrent({activePath:path,bytes,expectedActiveHash:null,
  writeChunk:async(handle,chunk,position)=>{
   const result=await handle.write(chunk,0,chunk.length,position);
   if(++writes===1)await assert.rejects(lstat(path),{code:'ENOENT'});
   return result.bytesWritten;
  },
 });
 assert.ok(writes>1);
 assert.deepEqual(await readFile(path),bytes);
 assert.deepEqual(await readdir(dir),['current.user.js']);
}));

test('external edit arriving while restore is staging cannot be overwritten',async()=>fixture(async(dir,path)=>{
 const original=Buffer.from('known-archived-current');
 const replacement=Buffer.from('new-approved-revision');
 await writeFile(path,original);
 let changed=false;
 await assert.rejects(commitManagedCurrent({
  activePath:path,bytes:replacement,expectedActiveHash:hash(original),
  writeChunk:async(handle,chunk,position)=>{
   const result=await handle.write(chunk,0,chunk.length,position);
   if(!changed){changed=true;await writeFile(path,'externally edited after initial check');}
   return result.bytesWritten;
  },
 }),/changed|external|hash|stale/i);
 assert.equal(await readFile(path,'utf8'),'externally edited after initial check');
 assert.deepEqual(await readdir(dir),['current.user.js']);
}));

test('newly appeared current is never overwritten by a late restore',async()=>fixture(async(dir,path)=>{
 let changed=false;
 await assert.rejects(commitManagedCurrent({
  activePath:path,bytes:Buffer.from('new revision'),expectedActiveHash:null,
  writeChunk:async(handle,chunk,position)=>{
   const result=await handle.write(chunk,0,chunk.length,position);
   if(!changed){changed=true;await writeFile(path,'arrived from another process');}
   return result.bytesWritten;
  },
 }),/changed|external|stale|appeared/i);
 assert.equal(await readFile(path,'utf8'),'arrived from another process');
 assert.deepEqual(await readdir(dir),['current.user.js']);
}));

test('disk failure during activation preserves old current and cleans the private stage',async()=>fixture(async(dir,path)=>{
 const original=Buffer.from('previous valid current');
 await writeFile(path,original);
 let writes=0;
 await assert.rejects(commitManagedCurrent({
  activePath:path,bytes:Buffer.alloc(130000,0x59),expectedActiveHash:hash(original),
  writeChunk:async(handle,chunk,position)=>{
   if(++writes===2)throw Object.assign(new Error('disk full on stage'),{code:'ENOSPC'});
   const result=await handle.write(chunk,0,chunk.length,position);
   return result.bytesWritten;
  },
 }),/disk full/i);
 assert.equal(writes,2);
 assert.deepEqual(await readFile(path),original);
 assert.deepEqual(await readdir(dir),['current.user.js']);
}));

test('caller must supply valid expected hash and cannot replace symlinked current',async(t)=>fixture(async(dir,path)=>{
 await assert.rejects(commitManagedCurrent({
  activePath:path,bytes:Buffer.from('new'),expectedActiveHash:'wrong',
 }),/hash|expected/i);
 const outside=join(dir,'outside.user.js');
 await writeFile(outside,'preserve external');
 try{await symlink(outside,path);}catch(e){
  if(['EPERM','EACCES','ENOTSUP'].includes((e as NodeJS.ErrnoException).code??'')){t.skip('symlinks unavailable');return;}
  throw e;
 }
 await assert.rejects(commitManagedCurrent({
  activePath:path,bytes:Buffer.from('new'),expectedActiveHash:null,
 }),/changed|external|unsafe|stale|appeared/i);
 assert.equal(await readFile(outside,'utf8'),'preserve external');
}));

test('first activation never overwrites a competing new current arriving immediately before publish',async()=>fixture(async(dir,path)=>{
 const newRevision=Buffer.from('known verified target revision');
 let hookCalled=false;
 await assert.rejects(commitManagedCurrent({
  activePath:path,bytes:newRevision,expectedActiveHash:null,
  // Reproduce another process creating current after the final preflight check,
  // exactly at the otherwise unsafe rename-to-current boundary.
  beforePublish:async()=>{hookCalled=true;await writeFile(path,'competing process current');},
 }),/exists|already|appeared|external|conflict|changed/i);
 assert.equal(hookCalled,true);
 assert.equal(await readFile(path,'utf8'),'competing process current');
 assert.deepEqual(await readdir(dir),['current.user.js']);
}));
