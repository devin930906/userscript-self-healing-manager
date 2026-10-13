import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {assertRecoveryDestinationOutsideSource} from '../src/recovery-destination.ts';

/** Synthetic only. No real user Data, scripts or backup destinations. */
async function temp(t:TestContext,run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-backup-lexical-boundary-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
async function link(t:TestContext,target:string,alias:string){
 try{await symlink(target,alias,process.platform==='win32'?'junction':'dir');return true;}
 catch(error){
  if(['EPERM','EACCES','ENOTSUP','EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code??'')){
   t.skip('Directory links/Junctions unavailable on this runner');return false;
  }
  throw error;
 }
}

test('RG-06 backup destination cannot disguise a path inside Data through symlink and parent traversal',async t=>
 temp(t,async root=>{
  const data=join(root,'Data'),nested=join(data,'nested'),outside=join(root,'external');
  await mkdir(nested,{recursive:true});await mkdir(outside);
  await writeFile(join(data,'preserve.txt'),'never modify synthetic source');
  const alias=join(root,'linked-to-Data');
  if(!await link(t,nested,alias))return;
  const disguised=alias+sep+'..'+sep+'backup.zip';
  await assert.rejects(
   assertRecoveryDestinationOutsideSource(data,disguised),
   /backup|source|Data|unsafe|traversal|directory/i,
   'lexical resolve() must not erase the linked component before canonical boundary checks');
  assert.equal(await readFile(join(data,'preserve.txt'),'utf8'),'never modify synthetic source');
 }));

test('RG-06 backup destination rejects relative parent traversal even if the source directory is ordinary',async t=>
 temp(t,async root=>{
  const data=join(root,'Data'),external=join(root,'external');
  await mkdir(data);await mkdir(external);
  await assert.rejects(
   assertRecoveryDestinationOutsideSource(data,external+sep+'..'+sep+'backup.zip'),
   /unsafe|traversal|backup|directory/i);
 }));

test('RG-06 recovery destination accepts a new external file and keeps ordinary dot-prefixed folder names',async t=>
 temp(t,async root=>{
  const data=join(root,'Data'),external=join(root,'..backups');
  await mkdir(data);await mkdir(external);
  await assert.doesNotReject(
   assertRecoveryDestinationOutsideSource(data,join(external,'backup.zip')));
 }));

test('RG-06 source path containing parent traversal cannot bypass backup containment validation',async t=>
 temp(t,async root=>{
  const data=join(root,'Data'),nested=join(data,'nested'),external=join(root,'external');
  await mkdir(nested,{recursive:true});await mkdir(external);
  const source=nested+sep+'..';
  await assert.rejects(
   assertRecoveryDestinationOutsideSource(source,join(external,'backup.zip')),
   /unsafe|traversal|source|directory/i);
 }));
