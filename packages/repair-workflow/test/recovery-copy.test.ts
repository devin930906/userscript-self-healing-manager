import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {link,lstat,mkdtemp,readFile,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {copyPinnedRecoveryFile} from '../src/recovery-copy.ts';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(run:(v:{root:string;source:string;target:string;bytes:Buffer})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-recovery-copy-'));
 try{
  const source=join(root,'snapshot.sqlite'),target=join(root,'offline-stage.sqlite');
  const bytes=Buffer.from('SYNTHETIC_SQLITE_RECOVERY_BYTES');
  await writeFile(source,bytes);
  await run({root,source,target,bytes});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('RG-06 pinned recovery copy writes only the intended source bytes into exclusive stage',async()=>fixture(async({source,target,bytes})=>{
 await copyPinnedRecoveryFile({
  source,destination:target,expected:{path:'registry.sqlite',bytes:bytes.length,sha256:sha(bytes)}
 });
 assert.deepEqual(await readFile(target),bytes);
 assert.deepEqual(await readFile(source),bytes);
}));
test('RG-06 pinned recovery copy does not open a source swapped to a private symlink',async()=>fixture(async({root,source,target,bytes})=>{
 const original=join(root,'original-snapshot.sqlite');
 const secret=join(root,'private-secret.sqlite');
 await writeFile(secret,'OTHER PRIVATE SECRET BYTES!!!');
 await assert.rejects(copyPinnedRecoveryFile({
  source,destination:target,expected:{path:'registry.sqlite',bytes:bytes.length,sha256:sha(bytes)},
  beforeSourceOpen:async()=>{
   await rename(source,original);
   await symlink(secret,source);
  },
 }),/identity|symlink|changed|unsafe|replaced/i);
 await assert.rejects(readFile(target),{code:'ENOENT'},'foreign source must never reach offline target');
 assert.deepEqual(await readFile(secret),Buffer.from('OTHER PRIVATE SECRET BYTES!!!'));
 assert.deepEqual(await readFile(original),bytes);
}));
test('RG-06 pinned recovery copy rejects byte-identical same-size source rename replacement',async()=>fixture(async({root,source,target,bytes})=>{
 const original=join(root,'approved-original.sqlite');
 await assert.rejects(copyPinnedRecoveryFile({
  source,destination:target,expected:{path:'registry.sqlite',bytes:bytes.length,sha256:sha(bytes)},
  beforeSourceOpen:async()=>{await rename(source,original);await writeFile(source,bytes);},
 }),/identity|changed|unsafe|replaced/i);
 await assert.rejects(readFile(target),{code:'ENOENT'});
 assert.deepEqual(await readFile(original),bytes);
}));
test('RG-06 pinned recovery copy refuses source hardlink aliases without modifying active bytes',async()=>fixture(async({root,source,target,bytes})=>{
 await link(source,join(root,'external-alias.sqlite'));
 await assert.rejects(copyPinnedRecoveryFile({
  source,destination:target,expected:{path:'registry.sqlite',bytes:bytes.length,sha256:sha(bytes)}
 }),/hardlink|alias|unsafe|identity/i);
 await assert.rejects(readFile(target),{code:'ENOENT'});
 assert.deepEqual(await readFile(source),bytes);
}));
test('RG-06 pinned recovery copy refuses an occupied target without overwriting',async()=>fixture(async({source,target,bytes})=>{
 await writeFile(target,'EXISTING_TARGET');
 await assert.rejects(copyPinnedRecoveryFile({
  source,destination:target,expected:{path:'registry.sqlite',bytes:bytes.length,sha256:sha(bytes)}
 }),/EEXIST|exist|exclusive|overwrite/i);
 assert.equal(await readFile(target,'utf8'),'EXISTING_TARGET');
}));
