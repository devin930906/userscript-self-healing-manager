import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {link,lstat,mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {persistImmutableSnapshot} from '../src/immutable-archive.ts';

test('RG-06 refuses a staged immutable backup with a foreign hardlink before publishing its hash-named path',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-staged-archive-alias-'));
 try{
  const bytes=Buffer.from('SYNTHETIC_APPROVED_RECOVERY_ARCHIVE');
  const sha=createHash('sha256').update(bytes).digest('hex');
  const archivePath=join(root,'revision-'+sha+'.user.js');
  const foreignAlias=join(root,'foreign-stage-alias.user.js');
  let injected=false;
  await assert.rejects(persistImmutableSnapshot({archivePath,bytes,
   writeChunk:async(handle,chunk,position)=>{
    const written=(await handle.write(chunk,0,chunk.length,position)).bytesWritten;
    const stage=(await readdir(root)).find(name=>name.includes('.staging-'));
    assert.ok(stage,'private stage must exist while a real write is in progress');
    assert.equal(injected,false,'inject exactly one foreign hardlink');
    await link(join(root,stage),foreignAlias);
    injected=true;
    assert.equal((await lstat(foreignAlias)).nlink,2);
    return written;
   },
  }),/hard.?link|alias|unsafe|immutable/i);
  assert.equal(injected,true,'real same-volume hardlink alias must have been created');
  await assert.rejects(lstat(archivePath),{code:'ENOENT'},
   'a known-aliased private stage must never become visible as an approved immutable backup');
  assert.deepEqual(await readFile(foreignAlias),bytes,
   'failed backup publication must not modify or delete foreign aliases');
  assert.deepEqual(await readdir(root),['foreign-stage-alias.user.js'],
   'private staging is cleaned up without touching third-party paths');
 }finally{await rm(root,{recursive:true,force:true});}
});
