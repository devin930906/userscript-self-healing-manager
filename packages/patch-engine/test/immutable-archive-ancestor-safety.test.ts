import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {persistImmutableSnapshot} from '../src/immutable-archive.ts';

const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');

test('RG-06 immutable archive low-level publisher refuses symlink/junction ancestor before staging',async t=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-immutable-ancestor-'));
 try{
  const actual=join(root,'outside-data');
  const alias=join(root,'linked-data');
  await mkdir(actual);
  await writeFile(join(actual,'preserve.txt'),'protected-existing-content');
  try{await symlink(actual,alias,process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Directory symlinks/junctions unavailable in this test environment');
    return;
   }
   throw error;
  }
  const bytes=Buffer.from('SYNTHETIC_ARCHIVE_APPROVED_BYTES');
  const archivePath=join(alias,'original-'+hash(bytes)+'.user.js');
  await assert.rejects(
   persistImmutableSnapshot({archivePath,bytes}),
   /unsafe|symlink|junction|ancestor|recovery directory/i,
   'exported archive writer must independently reject an aliased ancestor');
  assert.deepEqual(await readdir(actual),['preserve.txt'],
   'no staging or hash-named archive may be created outside the selected directory');
  assert.equal(await readFile(join(actual,'preserve.txt'),'utf8'),'protected-existing-content');
 }finally{await rm(root,{recursive:true,force:true});}
});
