import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {link,mkdtemp,readFile,rename,rm,symlink,unlink,writeFile} from 'node:fs/promises';
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
