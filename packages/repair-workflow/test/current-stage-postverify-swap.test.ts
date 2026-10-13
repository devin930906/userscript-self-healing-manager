import assert from 'node:assert/strict';
import {mkdtemp,lstat,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {commitManagedCurrent} from '../src/current-activation.ts';

async function isolate(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-postverify-stage-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
async function swapAfterVerification(root:string,replacement:Buffer):Promise<string>{
 const stage=(await readdir(root)).find(name=>name.includes('.staging-'));
 assert.ok(stage,'an fsynced, verified private staging name must exist');
 const moved=join(root,'original-reviewed-stage.tmp');
 await rename(join(root,stage),moved);
 await writeFile(join(root,stage),replacement,{mode:0o600});
 return moved;
}
test('RG-06 late unapproved changed-content stage cannot become a visible managed current',async()=>isolate(async root=>{
 const activePath=join(root,'current.user.js');
 const approved=Buffer.from('SYNTHETIC_APPROVED_MANAGED_REVISION');
 const changed=Buffer.from('UNTRUSTED_REPLACEMENT_STAGE_BYTES');
 assert.equal(changed.length,approved.length,'same-size substitution must exercise hash protection');
 let originalStage='';
 await assert.rejects(commitManagedCurrent({
  activePath,bytes:approved,expectedActiveHash:null,
  beforePublish:async()=>{originalStage=await swapAfterVerification(root,changed);},
 }),/stage|identity|hash|changed|verification/i);
 assert.notEqual(originalStage,'');
 await assert.rejects(lstat(activePath),{code:'ENOENT'},
  'failed verification must never publish an unreviewed current.user.js');
 assert.deepEqual(await readFile(originalStage),approved,
  'outside writer replacement must not mutate the original approved stage');
 assert.deepEqual(await readdir(root),['original-reviewed-stage.tmp']);
}));
test('RG-06 byte-identical late stage swap is still a different unapproved file',async()=>isolate(async root=>{
 const activePath=join(root,'current.user.js');
 const approved=Buffer.from('SYNTHETIC_SAME_BYTES_BUT_OTHER_FILE');
 let originalStage='';
 await assert.rejects(commitManagedCurrent({
  activePath,bytes:approved,expectedActiveHash:null,
  beforePublish:async()=>{originalStage=await swapAfterVerification(root,approved);},
 }),/stage|identity|replaced|changed|verification/i,
  'matching bytes alone cannot transfer approval to a newly created staging file');
 assert.notEqual(originalStage,'');
 await assert.rejects(lstat(activePath),{code:'ENOENT'});
 assert.deepEqual(await readFile(originalStage),approved);
 assert.deepEqual(await readdir(root),['original-reviewed-stage.tmp']);
}));
