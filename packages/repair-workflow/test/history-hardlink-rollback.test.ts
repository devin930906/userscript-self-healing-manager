import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {link,lstat,mkdir,mkdtemp,readFile,rm,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {activateManagedRevision,listManagedRevisions} from '../src/history.ts';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(task:(input:{
 root:string;folder:string;source:Buffer;archive:string;digest:string;
})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-hardlink-'));
 try{
  const folder=join(root,'managed','script-one');
  await mkdir(folder,{recursive:true});
  const source=Buffer.from('SYNTHETIC_APPROVED_ROLLBACK_ARCHIVE');
  const digest=sha(source);
  const archive=join(folder,'original-'+digest+'.user.js');
  await writeFile(archive,source);
  await task({root,folder,source,archive,digest});
 }finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06 revision inventory cannot certify immutable archive bytes writable through hardlink alias',async()=>fixture(async({root,folder,archive,source,digest})=>{
 const alias=join(root,'outside-but-synthetic.user.js');
 await link(archive,alias);
 assert.equal((await lstat(archive)).nlink,2);
 await assert.rejects(listManagedRevisions({managedRoot:root,scriptId:'script-one'}),
  /hard.?link|alias|unsafe|immutable/i);
 await assert.rejects(activateManagedRevision({
  managedRoot:root,scriptId:'script-one',hash:digest,
  approved:true,expectedCurrentHash:null,
 }),/hard.?link|alias|unsafe|immutable/i,
 'an externally writable alias cannot authorize an approved rollback');
 await assert.rejects(readFile(join(folder,'current.user.js')),{code:'ENOENT'});
 assert.deepEqual(await readFile(alias),source);
 await unlink(alias);
 const revisions=await listManagedRevisions({managedRoot:root,scriptId:'script-one'});
 assert.equal(revisions.length,1);
 assert.equal(revisions[0]?.verified,true);
 const restored=await activateManagedRevision({
  managedRoot:root,scriptId:'script-one',hash:digest,
  approved:true,expectedCurrentHash:null,
 });
 assert.deepEqual(await readFile(restored.activePath),source);
}));

test('RG-06 rollback refuses newly aliased previous archive without changing current revision',async()=>fixture(async({root,folder,archive,source,digest})=>{
 const other=Buffer.from('SYNTHETIC_NEW_REVISION');
 const otherHash=sha(other);
 await writeFile(join(folder,'revision-'+otherHash+'.user.js'),other);
 const current=await activateManagedRevision({
  managedRoot:root,scriptId:'script-one',hash:otherHash,
  approved:true,expectedCurrentHash:null,
 });
 assert.deepEqual(await readFile(current.activePath),other);
 const alias=join(root,'alternative-archive-alias.user.js');
 await link(archive,alias);
 await assert.rejects(activateManagedRevision({
  managedRoot:root,scriptId:'script-one',hash:digest,
  approved:true,expectedCurrentHash:otherHash,
 }),/hard.?link|alias|unsafe|immutable/i);
 assert.deepEqual(await readFile(current.activePath),other,
  'failed rollback must not alter the previously active managed revision');
 assert.deepEqual(await readFile(alias),source);
}));
