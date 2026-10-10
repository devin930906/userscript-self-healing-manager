import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,readdir,rm,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeExclusiveReport} from '../src/exclusive-report.ts';

test('a staged report changed after the first verification is never left visible',async()=>{
 for(const changedContent of ['{"forged":true}', 'z'.repeat(300)]){
  const root=await mkdtemp(join(tmpdir(),'usshm-report-race-'));
  try{
   const destinationPath=join(root,'report.json');
   const content='{"original":true}';
   await assert.rejects(
    writeExclusiveReport({destinationPath,content,beforePublish:async()=>{
     const stages=(await readdir(root)).filter(name=>name.includes('.staging-'));
     assert.equal(stages.length,1,'exactly one private staging file');
     await writeFile(join(root,stages[0]!),changedContent);
    }}),
    /changed|verification|SHA-256|staging|mismatch/i,
   );
   await assert.rejects(readFile(destinationPath),{code:'ENOENT'},
    'failed publication must not expose the altered report');
   assert.deepEqual(await readdir(root),[],'failed publication leaves no staging files');
  }finally{
   await rm(root,{recursive:true,force:true});
  }
 }
});

test('an invalid hard-linked publication is rolled back after the final link',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-report-after-link-'));
 try{
  const destinationPath=join(root,'report.json');
  await assert.rejects(writeExclusiveReport({
   destinationPath,content:'{"original":true}',
   afterPublish:async()=>{await writeFile(destinationPath,'{"mutated":true}');},
  }),/changed|SHA-256|mismatch|verification/i);
  await assert.rejects(readFile(destinationPath),{code:'ENOENT'});
  assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('rollback never removes a different file installed after linking',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-report-foreign-dest-'));
 try{
  const destinationPath=join(root,'report.json');
  await assert.rejects(writeExclusiveReport({
   destinationPath,content:'{"original":true}',
   afterPublish:async()=>{
    await unlink(destinationPath);
    await writeFile(destinationPath,'independent file');
   },
  }),error=>error instanceof AggregateError&&/rollback/i.test(error.message));
  assert.equal(await readFile(destinationPath,'utf8'),'independent file');
  assert.deepEqual(await readdir(root),['report.json']);
 }finally{await rm(root,{recursive:true,force:true});}
});
