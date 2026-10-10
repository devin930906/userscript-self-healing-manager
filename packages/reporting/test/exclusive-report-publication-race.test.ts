import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
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
