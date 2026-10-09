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
