import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {link,lstat,mkdtemp,readFile,readdir,rm,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {persistImmutableSnapshot} from '../src/immutable-archive.ts';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function temporary(run:(dir:string)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'usshm-archive-alias-'));
 try{await run(dir);}finally{await rm(dir,{recursive:true,force:true});}
}

test('RG-06 a preexisting matching hardlink is not accepted as an immutable archive',async()=>temporary(async dir=>{
 const bytes=Buffer.from('SYNTHETIC_APPROVED_ARCHIVE_BYTES');
 const source=join(dir,'synthetic-outside.user.js');
 const archive=join(dir,'revision-'+sha(bytes)+'.user.js');
 await writeFile(source,bytes);
 await link(source,archive);
 assert.equal((await lstat(archive)).nlink,2,'test must exercise a real filesystem hardlink');
 await assert.rejects(persistImmutableSnapshot({archivePath:archive,bytes}),
  /hard.?link|alias|link count|immutable/i,
  'matching bytes alone must not approve an archive writable through another filename');
 assert.deepEqual(await readFile(source),bytes,'never modify the external alias');
 assert.deepEqual(await readFile(archive),bytes,'never modify the linked archive');
 const names=await readdir(dir);
 assert.equal(names.length,2,'failed publication must clean up only its private staging path');
}));

test('RG-06 repeated archive publication refuses newly aliased content until isolation is restored',async()=>temporary(async dir=>{
 const bytes=Buffer.from('SYNTHETIC_REVISION_AFTER_REVIEW');
 const archive=join(dir,'revision-'+sha(bytes)+'.user.js');
 const other=join(dir,'independent-alias.user.js');
 await persistImmutableSnapshot({archivePath:archive,bytes});
 assert.equal((await lstat(archive)).nlink,1,'a completed archive must have one directory entry');
 await link(archive,other);
 assert.equal((await lstat(archive)).nlink,2);
 await assert.rejects(persistImmutableSnapshot({archivePath:archive,bytes}),
  /hard.?link|alias|link count|immutable/i);
 assert.deepEqual(await readFile(other),bytes,'reject without unlinking or changing another path');
 await unlink(other);
 await persistImmutableSnapshot({archivePath:archive,bytes});
 assert.deepEqual(await readFile(archive),bytes,'a re-isolated archive remains idempotent');
 assert.equal((await lstat(archive)).nlink,1);
}));
