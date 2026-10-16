import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureWritableDataRoot} from '../src/index.ts';

test('RG-07 Data root non-directory errors do not reveal selected filesystem components',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-data-root-privacy-'));
 try{
  const privateComponent=join(root,'SYNTHETIC_PRIVATE_DATA_COMPONENT');
  await writeFile(privateComponent,'SYNTHETIC_ONLY');
  await assert.rejects(ensureWritableDataRoot(privateComponent),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Data path is not a directory');
   assert.doesNotMatch(error.message,/SYNTHETIC_PRIVATE_DATA_COMPONENT|usshm-data-root-privacy/);
   assert.equal('cause' in error,false);
   return true;
  });
 }finally{await rm(root,{recursive:true,force:true});}
});

test('RG-07 Data root linked-ancestor errors do not include private filesystem paths',async t=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-data-root-link-privacy-'));
 try{
  const physical=join(root,'safe-target');
  const privateAlias=join(root,'SYNTHETIC_PRIVATE_LINK_ALIAS');
  await mkdir(physical);
  try{await symlink(physical,privateAlias,process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','EACCES','ENOTSUP','EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Directory symlinks not available on runner');return;
   }
   throw error;
  }
  await assert.rejects(ensureWritableDataRoot(privateAlias),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Data root cannot contain symlinks');
   assert.doesNotMatch(error.message,/SYNTHETIC_PRIVATE_LINK_ALIAS|usshm-data-root-link-privacy/);
   assert.equal('cause' in error,false);
   return true;
  });
 }finally{await rm(root,{recursive:true,force:true});}
});
