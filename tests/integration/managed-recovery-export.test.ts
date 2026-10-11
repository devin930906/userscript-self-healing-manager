import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

async function exporter(){
 const api=await import('../../packages/repair-workflow/src/managed-export.ts').catch(()=>({})) as {
  exportManagedRecovery?: (input:{managedRoot:string;destination:string})=>
   Promise<{path:string;files:readonly {path:string;sha256:string;bytes:number}[]}>};
 assert.equal(typeof api.exportManagedRecovery,'function','verified managed recovery export API must exist');
 return api.exportManagedRecovery!;
}
const SHA=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(root:string){
 const scriptId='abc-123';
 const managed=join(root,'managed',scriptId);
 await mkdir(managed,{recursive:true});
 const original=Buffer.from('// ==UserScript==\n// @name Original\n// ==/UserScript==\n');
 const patched=Buffer.from('// ==UserScript==\n// @name Patched\n// ==/UserScript==\n');
 const originalHash=SHA(original),patchedHash=SHA(patched);
 await writeFile(join(managed,'original-'+originalHash+'.user.js'),original);
 await writeFile(join(managed,'revision-'+patchedHash+'.user.js'),patched);
 await writeFile(join(managed,'current.user.js'),patched);
 return {managed,scriptId,originalHash,patchedHash,original,patched};
}

test('managed recovery export copies only hashed immutable revisions and matching current with verifiable manifest',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-managed-export-'));
 try{
  const dataRoot=join(dir,'Data'); await mkdir(dataRoot);
  const f=await fixture(dataRoot);
  const destination=join(dir,'managed-recovery');
  const exportManagedRecovery=await exporter();
  const receipt=await exportManagedRecovery({managedRoot:dataRoot,destination});
  assert.equal(receipt.path,destination);
  assert.equal(receipt.files.length,3);
  assert.deepEqual(receipt.files.map(x=>x.path).sort(),[
   'managed/'+f.scriptId+'/current.user.js',
   'managed/'+f.scriptId+'/original-'+f.originalHash+'.user.js',
   'managed/'+f.scriptId+'/revision-'+f.patchedHash+'.user.js'
  ].sort());
  for(const file of receipt.files){
   const bytes=await readFile(join(destination,...file.path.split('/')));
   assert.equal(SHA(bytes),file.sha256);
   assert.equal(bytes.length,file.bytes);
  }
  const manifest=JSON.parse(await readFile(join(destination,'manifest.json'),'utf8'));
  assert.equal(manifest.kind,'usshm-managed-recovery-v1');
  assert.equal(manifest.files.length,3);
  assert.equal(manifest.complete,true);
  assert.deepEqual(manifest.files,receipt.files);
  await assert.rejects(exportManagedRecovery({managedRoot:dataRoot,destination}),/exist|overwrite|already|refus/i);
  const listing=await readdir(destination);
  assert.equal(listing.includes('manifest.json'),true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('managed recovery export fails closed on current not in archive, without publishing a complete manifest',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-managed-unsafe-'));
 try{
  const dataRoot=join(dir,'Data');await mkdir(dataRoot);
  const f=await fixture(dataRoot);
  await writeFile(join(f.managed,'current.user.js'),'externally modified, not an immutable revision');
  const exportManagedRecovery=await exporter();
  const destination=join(dir,'recovery');
  await assert.rejects(exportManagedRecovery({managedRoot:dataRoot,destination}),/unarchived|hash|unsafe|current/i);
  await assert.rejects(readFile(join(destination,'manifest.json')));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('managed recovery export rejects symlink, write lock, and destination inside source Data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-managed-guard-'));
 try{
  const dataRoot=join(dir,'Data');await mkdir(dataRoot);
  const f=await fixture(dataRoot);
  const exportManagedRecovery=await exporter();
  await assert.rejects(exportManagedRecovery({managedRoot:dataRoot,destination:join(dataRoot,'backup')}),/inside|source|unsafe|destination/i);
  await mkdir(join(f.managed,'current.user.js.write-lock'));
  await assert.rejects(exportManagedRecovery({managedRoot:dataRoot,destination:join(dir,'locked')}),/lock|unsafe|write/i);
  await rm(join(f.managed,'current.user.js.write-lock'),{recursive:true});
  await symlink(join(f.managed,'current.user.js'),join(f.managed,'alias.user.js'));
  await assert.rejects(exportManagedRecovery({managedRoot:dataRoot,destination:join(dir,'linked')}),/symlink|unsafe|unexpected/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});


test('managed recovery verification rejects modified archive and traversal manifest without restore',async()=>{
 const api=await import('../../packages/repair-workflow/src/managed-export.ts');
 const verify=(api as unknown as {verifyManagedRecovery?:(
  input:{snapshotDirectory:string}
 )=>Promise<{files:number;bytes:number}>}).verifyManagedRecovery;
 assert.equal(typeof verify,'function','read-only managed archive verification API must exist');
 const dir=await mkdtemp(join(tmpdir(),'usshm-managed-verify-'));
 try{
  const root=join(dir,'Data');await mkdir(root);
  const f=await fixture(root);
  const folder=join(dir,'backup');
  await (await exporter())({managedRoot:root,destination:folder});
  assert.deepEqual(await verify!({snapshotDirectory:folder}),{
   files:3,bytes:f.original.length+f.patched.length*2
  });
  await writeFile(join(folder,'managed',f.scriptId,'current.user.js'),'tampered backup');
  await assert.rejects(verify!({snapshotDirectory:folder}),/hash|mismatch|tamper|integrity/i);
  // Restore the byte-for-byte archive, then attack the JSON path.
  await writeFile(join(folder,'managed',f.scriptId,'current.user.js'),f.patched);
  const manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'));
  manifest.files[0].path='../outside.user.js';
  await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(verify!({snapshotDirectory:folder}),/path|unsafe|traversal|manifest/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});
