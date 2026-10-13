import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,lstat} from 'node:fs/promises';
import {join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {readPinnedRegularFile} from '../src/pinned-file.ts';

/** Synthetic temporary files only. No real user source or Chrome Data. */
async function fixture(t:TestContext,run:(root:string,real:string,alias:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-pinned-ancestor-'));
 try{
  const real=join(root,'private-physical');
  await mkdir(real);
  const alias=join(root,'selected-link');
  try{await symlink(real,alias,process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','EACCES','ENOTSUP','EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Directory symlinks/Junctions unavailable');
    return;
   }
   throw error;
  }
  await run(root,real,alias);
 }finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06 pinned reader refuses a regular leaf reached through a linked directory',async t=>
 fixture(t,async(_root,real,alias)=>{
  const content='PRIVATE SYNTHETIC SECRET';
  const original=join(real,'unselected.user.js');
  const linked=join(alias,'unselected.user.js');
  await writeFile(original,content);
  const expected=await lstat(linked);
  const expectedNative=await lstat(linked,{bigint:true});
  assert.ok(expected.isFile()&&!expected.isSymbolicLink(),
   'the final file is regular, so leaf-only checks do not identify its linked parent');
  await assert.rejects(
   readPinnedRegularFile(linked,{maxBytes:1024,expected,expectedNative}),
   /unsafe|symlink|junction|ancestor|directory/i,
   'a pinned descriptor must not authorize a file under an aliased parent');
  assert.equal(await readFile(original,'utf8'),content);
 }));

test('RG-06 pinned reader rejects parent traversal even when it hides a linked component',async t=>
 fixture(t,async(_root,real,alias)=>{
  await mkdir(join(real,'nested'));
  const fixtureBytes='SYNTHETIC PARENT SECRET';
  const original=join(real,'unselected.user.js');
  await writeFile(original,fixtureBytes);
  // This path crosses a link before resolving the parent component.
  const nestedAlias=join(_root,'linked-nested');
  try{await symlink(join(real,'nested'),nestedAlias,process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','EACCES','ENOTSUP','EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Nested directory symlinks/Junctions unavailable');return;
   }
   throw error;
  }
  const disguised=nestedAlias+sep+'..'+sep+'unselected.user.js';
  await assert.rejects(
   readPinnedRegularFile(disguised,{maxBytes:1024}),
   /unsafe|parent traversal|symlink|junction|directory/i);
  assert.equal(await readFile(original,'utf8'),fixtureBytes);
 }));

test('RG-06 pinned reader preserves ordinary source and a pinned exact native snapshot',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-pinned-regular-'));
 try{
  const source=join(root,'plain.user.js');
  const bytes=Buffer.from('// regular source\r\n');
  await writeFile(source,bytes);
  const expected=await lstat(source);
  const expectedNative=await lstat(source,{bigint:true});
  assert.deepEqual(await readPinnedRegularFile(source,{maxBytes:1024,expected,expectedNative}),bytes);
 }finally{await rm(root,{recursive:true,force:true});}
});
