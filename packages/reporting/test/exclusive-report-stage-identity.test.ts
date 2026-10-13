import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {writeExclusiveReport} from '../src/exclusive-report.ts';

test('RG-07 rejects byte-identical replacement of the original private staging inode',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-stage-swap-'));
 try{
  const destinationPath=join(root,'diagnostics.json');
  const movedOriginal=join(root,'original-private-stage.tmp');
  const content='{"synthetic":"PRIVATE_EVIDENCE_CANARY"}';
  let injected=false;
  await assert.rejects(writeExclusiveReport({destinationPath,content,
   beforePublish:async()=>{
    const stage=(await readdir(root)).find(name=>name.includes('.staging-'));
    assert.ok(stage,'original private staging file must exist');
    const stagePath=join(root,stage);
    await rename(stagePath,movedOriginal);
    await writeFile(stagePath,content,{mode:0o600});
    injected=true;
   },
  }),/identity|replaced|staging|changed|unsafe/i,
  'a different inode with the same SHA-256 may not inherit staging approval');
  assert.equal(injected,true,'the identity swap was exercised');
  await assert.rejects(readFile(destinationPath),{code:'ENOENT'},
   'never publish a file that replaced the private staging inode');
  assert.equal(await readFile(movedOriginal,'utf8'),content,
   'never modify or delete the original file moved away by the fixture');
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});
