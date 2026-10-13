import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,lstat,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {persistImmutableSnapshot} from '../src/immutable-archive.ts';

const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
async function fixture(run:(dir:string)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'usshm-postlink-cleanup-'));
 try{await run(dir);}finally{await rm(dir,{recursive:true,force:true});}
}

test('RG-06 post-link failed hash check removes only our newly published corrupted archive',async()=>fixture(async dir=>{
 const bytes=Buffer.from('SYNTHETIC_VERIFIED_REVISION_BYTES');
 const archive=join(dir,'revision-'+hash(bytes)+'.user.js');
 let published=false;
 await assert.rejects(persistImmutableSnapshot({archivePath:archive,bytes,
  afterPublish:async()=>{
   const current=await readFile(archive);
   assert.deepEqual(current,bytes,'test must run after a newly published hardlink exists');
   published=true;
   const stage=(await readdir(dir)).find(name=>name.includes('.staging-'));
   assert.ok(stage);
   await writeFile(join(dir,stage),Buffer.alloc(bytes.length,0x58));
  },
 }),/hash|conflict|archive|verification|changed/i);
 assert.equal(published,true);
 await assert.rejects(lstat(archive),{code:'ENOENT'},
  'a failed newly published archive must not persist under an approved SHA name');
 assert.deepEqual(await readdir(dir),[],'private staging must also be cleaned');
}));

test('RG-06 failed verification never removes an externally replaced archive pathname',async()=>fixture(async dir=>{
 const bytes=Buffer.from('SYNTHETIC_VERIFIED_REVISION_BYTES');
 const external=Buffer.from('EXTERNAL_REVISION_MUST_BE_PRESERVED');
 const archive=join(dir,'original-'+hash(bytes)+'.user.js');
 const moved=join(dir,'approved-owned-moved.tmp');
 await assert.rejects(persistImmutableSnapshot({archivePath:archive,bytes,
  afterPublish:async()=>{
   await rename(archive,moved);
   await writeFile(archive,external);
  },
 }),/hash|conflict|archive|verification|changed/i);
 assert.deepEqual(await readFile(archive),external,
  'new foreign pathname must never be unlinked by error cleanup');
 assert.deepEqual(await readFile(moved),bytes,
  'the original published inode remains untouched at the foreign chosen location');
 assert.deepEqual((await readdir(dir)).sort(),
  ['approved-owned-moved.tmp','original-'+hash(bytes)+'.user.js'].sort());
}));
