import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,lstat,readFile,readdir,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {persistImmutableSnapshot} from '../src/immutable-archive.ts';

const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
test('RG-06 changing the parent into a junction after stage verification never publishes an immutable archive',async t=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-immutable-late-parent-'));
 try{
  const managed=join(root,'managed');
  const moved=join(root,'relocated-managed');
  await mkdir(managed);
  await writeFile(join(managed,'preserve.txt'),'SYNTHETIC_OLD_DATA');
  const probe=join(root,'junction-capability-check');
  try{
   await symlink(managed,probe,process.platform==='win32'?'junction':'dir');
  }catch(error){
   if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Directory symlink/Junction unavailable in this CI environment');
    return;
   }
   throw error;
  }
  await rm(probe);
  const bytes=Buffer.from('SYNTHETIC_APPROVED_ARCHIVE');
  const archiveName='revision-'+sha(bytes)+'.user.js';
  const archivePath=join(managed,archiveName);
  let swapped=false;
  await assert.rejects(persistImmutableSnapshot({
   archivePath,bytes,
   beforePublish:async()=>{
    await rename(managed,moved);
    await symlink(moved,managed,process.platform==='win32'?'junction':'dir');
    swapped=true;
   },
  }),/unsafe|symlink|junction|ancestor|directory/i);
  assert.equal(swapped,true,'replace the parent after staging and exact-byte verification');
  await assert.rejects(lstat(join(moved,archiveName)),{code:'ENOENT'},
   'the hash-named revision must never be published through a late parent junction');
  assert.deepEqual(await readdir(moved),['preserve.txt']);
  assert.equal(await readFile(join(moved,'preserve.txt'),'utf8'),'SYNTHETIC_OLD_DATA');
 }finally{await rm(root,{recursive:true,force:true});}
});
