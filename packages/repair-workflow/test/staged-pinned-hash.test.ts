import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {link,mkdir,mkdtemp,readFile,rename,rm,symlink,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {shaFile} from '../src/core-recovery.ts';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(run:(v:{root:string;source:string;bytes:Buffer})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-pinned-stage-audit-'));
 try{
  const source=join(root,'staged.sqlite');
  const bytes=Buffer.from('SYNTHETIC_STAGED_SQLITE_BYTES');
  await writeFile(source,bytes);
  await run({root,source,bytes});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('RG-06 staged recovery hash audits actual pinned descriptor bytes',async()=>fixture(async({source,bytes})=>{
 assert.deepEqual(await shaFile(source,bytes.length),{sha256:hash(bytes),bytes:bytes.length});
}));
test('RG-06 staged recovery hashing refuses byte-identical file identity replacement between lstat and open',async()=>fixture(async({root,source,bytes})=>{
 const prior=join(root,'first-snapshot.sqlite');
 await assert.rejects(shaFile(source,bytes.length,async()=>{
  await rename(source,prior);
  await writeFile(source,bytes);
 }),/identity|changed|replaced|unsafe/i);
 assert.deepEqual(await readFile(prior),bytes);
 assert.deepEqual(await readFile(source),bytes);
}));
test('RG-06 staged recovery hashing never follows a late symlink to unrelated private data',async t=>fixture(async({root,source,bytes})=>{
 const privateSource=join(root,'outside-private.sqlite');
 const capability=join(root,'symlink-capability.sqlite');
 await writeFile(privateSource,Buffer.alloc(bytes.length,0x53));
 try{await symlink(privateSource,capability);}
 catch(e){
  if(['EPERM','EACCES','ENOTSUP','ENOSYS'].includes((e as NodeJS.ErrnoException).code??'')){
   t.skip('Symlink unavailable on this Windows runner; rename replacement remains independently tested');
   return;
  }
  throw e;
 }
 await unlink(capability);
 const prior=join(root,'original.sqlite');
 await assert.rejects(shaFile(source,bytes.length,async()=>{
  await rename(source,prior);
  await symlink(privateSource,source);
 }),/symlink|identity|unsafe|changed|replaced/i);
 assert.deepEqual(await readFile(prior),bytes);
 assert.deepEqual(await readFile(privateSource),Buffer.alloc(bytes.length,0x53));
}));
test('RG-06 staged recovery hashing refuses mutable hardlink aliases',async()=>fixture(async({root,source,bytes})=>{
 await link(source,join(root,'external.sqlite'));
 await assert.rejects(shaFile(source,bytes.length),/hardlink|alias|unsafe/i);
 assert.deepEqual(await readFile(source),bytes);
}));

test('RG-06 pinned recovery hash rejects a preexisting linked ancestor with identical inode and bytes',async t=>fixture(async({root,bytes})=>{
 const linked=join(root,'linked-parent');
 try{await symlink(root,linked,process.platform==='win32'?'junction':'dir');}
 catch(e){
  if(['EPERM','EACCES','ENOTSUP','ENOSYS'].includes((e as NodeJS.ErrnoException).code??'')){
   t.skip('Runner cannot create a directory symlink or Windows junction');return;
  }
  throw e;
 }
 const aliased=join(linked,'staged.sqlite');
 assert.deepEqual(await readFile(aliased),bytes,'the alias must resolve to the same approved file');
 await assert.rejects(shaFile(aliased,bytes.length),/symlink|junction|linked|unsafe/i,
  'matching descriptor identity and hash do not authorize a linked parent');
}));
test('RG-06 pinned recovery hash rejects a linked ancestor substituted after initial lstat',async t=>fixture(async({root,bytes})=>{
 const chosen=join(root,'chosen');
 const relocated=join(root,'relocated');
 const probe=join(root,'symlink-probe');
 await mkdir(chosen);
 const file=join(chosen,'source.sqlite');
 await writeFile(file,bytes);
 try{await symlink(chosen,probe,process.platform==='win32'?'junction':'dir');}
 catch(e){
  if(['EPERM','EACCES','ENOTSUP','ENOSYS'].includes((e as NodeJS.ErrnoException).code??'')){
   t.skip('Runner cannot create a directory symlink or Windows junction');return;
  }
  throw e;
 }
 await unlink(probe);
 await assert.rejects(shaFile(file,bytes.length,async()=>{
  await rename(chosen,relocated);
  await symlink(relocated,chosen,process.platform==='win32'?'junction':'dir');
 }),/symlink|junction|linked|unsafe/i,
  'the same open inode must not mask a parent that became a junction during the hash');
 assert.deepEqual(await readFile(file),bytes);
}));

test('RG-06 pinned recovery hashing rejects invalid and unbounded size budgets',async()=>fixture(async({source,bytes})=>{
 for(const budget of [Number.NaN,Number.POSITIVE_INFINITY,-1,1.5,512*1024*1024+1]){
  await assert.rejects(shaFile(source,budget),/invalid recovery snapshot size budget/i,
   'non-finite, negative, fractional or excessive limits must never bypass the bounded read');
 }
 assert.deepEqual(await shaFile(source,bytes.length),
  {sha256:hash(bytes),bytes:bytes.length},'a valid finite exact bound still hashes normally');
}));
