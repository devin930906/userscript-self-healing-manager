import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,lstat,symlink,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {persistImmutableSnapshot} from '../src/immutable-archive.ts';

const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
async function fixture(fn:(folder:string)=>Promise<void>){
 const folder=await mkdtemp(join(tmpdir(),'usshm-immutable-'));
 try{await fn(folder)}finally{await rm(folder,{recursive:true,force:true})}
}
test('immutable snapshot is exact-byte durable output and repeated equal bytes are idempotent',async()=>fixture(async folder=>{
 const bytes=Buffer.alloc(140000,0x61);
 const path=join(folder,'revision-'+sha(bytes)+'.user.js');
 await persistImmutableSnapshot({archivePath:path,bytes});
 assert.deepEqual(await readFile(path),bytes);
 await persistImmutableSnapshot({archivePath:path,bytes});
 assert.deepEqual(await readFile(path),bytes);
}));
test('an existing archive with mismatched bytes cannot be overwritten or silently treated as valid',async()=>fixture(async folder=>{
 const bytes=Buffer.from('expected userscript');
 const path=join(folder,'original-'+sha(bytes)+'.user.js');
 await writeFile(path,'tampered archive bytes');
 await assert.rejects(persistImmutableSnapshot({archivePath:path,bytes}),/conflict|hash|archive|immutable/i);
 assert.equal(await readFile(path,'utf8'),'tampered archive bytes');
}));
test('short write or ENOSPC removes only the archive created by this attempt',async()=>fixture(async folder=>{
 const bytes=Buffer.alloc(130000,0x62);
 const path=join(folder,'revision-'+sha(bytes)+'.user.js');
 let writes=0;
 await assert.rejects(persistImmutableSnapshot({
  archivePath:path,bytes,
  writeChunk:async(handle,chunk,position)=>{
   if(++writes===2){const e=Object.assign(new Error('simulated disk full'),{code:'ENOSPC'});throw e;}
   const result=await handle.write(chunk,0,chunk.length,position);
   return result.bytesWritten;
  },
 }),/disk full/);
 assert.ok(writes>=2,'exercise an actual partial disk write before failure');
 await assert.rejects(lstat(path),{code:'ENOENT'});
 // A failed attempt must not poison the immutable revision path.
 await persistImmutableSnapshot({archivePath:path,bytes});
 assert.deepEqual(await readFile(path),bytes);
}));
test('incorrect write-byte accounting also removes its partial archive',async()=>fixture(async folder=>{
 const bytes=Buffer.from('safe bytes');
 const path=join(folder,'revision-'+sha(bytes)+'.user.js');
 await assert.rejects(persistImmutableSnapshot({
  archivePath:path,bytes,writeChunk:async()=>0,
 }),/short|write|progress|invalid/i);
 await assert.rejects(lstat(path),{code:'ENOENT'});
}));
test('symlinked archive path is rejected without modifying its target',async(t)=>fixture(async folder=>{
 const bytes=Buffer.from('new script bytes');
 const outside=join(folder,'outside.user.js'),path=join(folder,'original-'+sha(bytes)+'.user.js');
 await writeFile(outside,'do not touch');
 try{await symlink(outside,path);}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes((e as NodeJS.ErrnoException).code??'')){t.skip('Cannot make symlink');return;}throw e;}
 await assert.rejects(persistImmutableSnapshot({archivePath:path,bytes}),/symlink|regular|unsafe|conflict/i);
 assert.equal(await readFile(outside,'utf8'),'do not touch');
}));

test('read-back hash failure removes a newly created but corrupted archive',async()=>fixture(async folder=>{
 const bytes=Buffer.from('the original approved revision bytes');
 const path=join(folder,'revision-'+sha(bytes)+'.user.js');
 await assert.rejects(persistImmutableSnapshot({
  archivePath:path,bytes,
  writeChunk:async(handle,chunk,position)=>{
   const corrupted=Buffer.from(chunk);
   corrupted[0]^=0x01;
   const result=await handle.write(corrupted,0,corrupted.length,position);
   return result.bytesWritten;
  },
 }),/conflict|hash|corrupt/i);
 await assert.rejects(lstat(path),{code:'ENOENT'});
 await persistImmutableSnapshot({archivePath:path,bytes});
 assert.deepEqual(await readFile(path),bytes);
}));

test('an in-progress write never exposes an incomplete hash-named revision',async()=>fixture(async folder=>{
 const bytes=Buffer.alloc(180000,0x5a);
 const path=join(folder,'revision-'+sha(bytes)+'.user.js');
 let writes=0;
 await persistImmutableSnapshot({archivePath:path,bytes,
  writeChunk:async(handle,chunk,position)=>{
   const result=await handle.write(chunk,0,chunk.length,position);
   if(++writes===1)await assert.rejects(lstat(path),{code:'ENOENT'});
   return result.bytesWritten;
  },
 });
 assert.ok(writes>=2,'exercise multiple disk write operations');
 assert.deepEqual(await readFile(path),bytes);
 const names=await (await import('node:fs/promises')).readdir(folder);
 assert.deepEqual(names,[path.split(/[\\/]/).at(-1)]);
}));

test('two simultaneous producers of the same revision do not treat a partial archive as an immutable conflict',async()=>fixture(async folder=>{
 const bytes=Buffer.alloc(160000,0x43);
 const path=join(folder,'revision-'+sha(bytes)+'.user.js');
 let unblock!:()=>void;
 const blocker=new Promise<void>(resolve=>{unblock=resolve;});
 let firstStarted!:()=>void;
 const started=new Promise<void>(resolve=>{firstStarted=resolve;});
 let firstWrite=true;
 const first=persistImmutableSnapshot({archivePath:path,bytes,
  writeChunk:async(handle,chunk,position)=>{
   const result=await handle.write(chunk,0,chunk.length,position);
   if(firstWrite){firstWrite=false;firstStarted();await blocker;}
   return result.bytesWritten;
  },
 });
 await started;
 try{await persistImmutableSnapshot({archivePath:path,bytes});}
 finally{unblock();}
 await first;
 assert.deepEqual(await readFile(path),bytes);
 const names=await (await import('node:fs/promises')).readdir(folder);
 assert.deepEqual(names,[path.split(/[\\/]/).at(-1)]);
}));
