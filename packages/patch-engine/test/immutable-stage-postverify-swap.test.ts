import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,lstat,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {persistImmutableSnapshot} from '../src/immutable-archive.ts';

const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function fixture(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-archive-late-swap-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
async function replaceVerifiedStage(root:string,replacement:Uint8Array):Promise<string>{
 const name=(await readdir(root)).find(n=>n.includes('.staging-'));
 assert.ok(name,'verified private stage should exist before publication');
 const original=join(root,'preserved-reviewed-stage.tmp');
 await rename(join(root,name),original);
 await writeFile(join(root,name),replacement,{mode:0o600});
 return original;
}
test('RG-06 changed bytes substituted after immutable stage verification never publish an archive',async()=>fixture(async root=>{
 const bytes=Buffer.from('SYNTHETIC_APPROVED_ARCHIVE_BYTES');
 const changed=Buffer.alloc(bytes.length,0x58);
 const archivePath=join(root,'revision-'+hash(bytes)+'.user.js');
 let oldStage='';
 await assert.rejects(persistImmutableSnapshot({
  archivePath,bytes,
  beforePublish:async()=>{oldStage=await replaceVerifiedStage(root,changed);},
 }),/stage|identity|changed|hash|unsafe|archive/i);
 assert.notEqual(oldStage,'','injection must execute after successful first stage check');
 await assert.rejects(lstat(archivePath),{code:'ENOENT'},
  'late unapproved bytes must never become addressable under approved hash name');
 assert.deepEqual(await readFile(oldStage),bytes);
 assert.deepEqual(await readdir(root),['preserved-reviewed-stage.tmp']);
}));
test('RG-06 byte-identical replacement inode cannot inherit verified archive-stage approval',async()=>fixture(async root=>{
 const bytes=Buffer.from('SYNTHETIC_SAME_BYTES_NEW_STAGE_INODE');
 const archivePath=join(root,'original-'+hash(bytes)+'.user.js');
 let oldStage='';
 await assert.rejects(persistImmutableSnapshot({
  archivePath,bytes,
  beforePublish:async()=>{oldStage=await replaceVerifiedStage(root,bytes);},
 }),/stage|identity|changed|hash|unsafe|archive/i,
  'approval attaches to the verified file identity, not just equal hash');
 assert.notEqual(oldStage,'');
 await assert.rejects(lstat(archivePath),{code:'ENOENT'});
 assert.deepEqual(await readFile(oldStage),bytes);
 assert.deepEqual(await readdir(root),['preserved-reviewed-stage.tmp']);
}));
