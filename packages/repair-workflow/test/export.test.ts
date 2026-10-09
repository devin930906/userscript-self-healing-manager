import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,mkdir,symlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRepairWorkflow} from '../src/index.ts';
import {exportManagedCurrent,publishExclusiveExport} from '../src/export.ts';
import {commitManagedCurrent} from '../src/current-activation.ts';

async function setup(){
 const root=await mkdtemp(join(tmpdir(),'usshm-export-'));
 const sourcePath=join(root,'input.user.js');const managedRoot=join(root,'Data');const destination=join(root,'repaired.user.js');
 const input='// ==UserScript==\n// @name Example\n// ==/UserScript==\ndocument.querySelector("#old");\n';
 await writeFile(sourcePath,input);
 const flow=createRepairWorkflow({managedRoot});
 const p=await flow.propose({sourcePath,scriptId:'demo',oldSelector:'#old',newSelector:'#new'});
 const receipt=await flow.apply({proposalId:p.proposalId,approved:true});
 return {root,sourcePath,managedRoot,destination,input,receipt};
}
test('export verified managed revision as user-installable userscript without modifying original or archive',async()=>{
 const q=await setup();try{
  const output=await exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',destinationPath:q.destination});
  assert.equal(output.path,q.destination);
  assert.match(await readFile(q.destination,'utf8'),/#new/);
  assert.equal(await readFile(q.sourcePath,'utf8'),q.input);
  assert.equal(await readFile(q.receipt.managedPath,'utf8'),await readFile(q.destination,'utf8'));
  await assert.rejects(exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',destinationPath:q.destination}),/exists|overwrite/i);
 }finally{await rm(q.root,{recursive:true,force:true});}
});
test('export refuses unarchived external edits to current and prevents overwriting another file',async()=>{
 const q=await setup();try{
  const current=join(q.managedRoot,'managed','demo','current.user.js');
  await writeFile(current,'document.querySelector("#external");');
  await assert.rejects(exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',destinationPath:q.destination}),/unverified|unmanaged/i);
  await assert.rejects(readFile(q.destination),{code:'ENOENT'});
 }finally{await rm(q.root,{recursive:true,force:true});}
});
test('export blocks managed-root destinations and existing symlink outputs',async(t)=>{
 const q=await setup();try{
  await assert.rejects(exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',destinationPath:join(q.managedRoot,'managed','demo','new.user.js')}),/managed/i);
  await writeFile(q.destination,'user existing content');
  await assert.rejects(exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',destinationPath:q.destination}),/exists|overwrite/i);
  assert.equal(await readFile(q.destination,'utf8'),'user existing content');
  const outside=join(q.root,'outside.user.js');
  try{await symlink(outside,join(q.root,'shortcut.user.js'));}catch(e){if(['EPERM','EACCES'].includes((e as NodeJS.ErrnoException).code??'')){t.skip('Cannot create symlink');return;}throw e;}
  await assert.rejects(exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',destinationPath:join(q.root,'shortcut.user.js')}),/exists|overwrite/i);
  await assert.rejects(readFile(outside),{code:'ENOENT'});
 }finally{await rm(q.root,{recursive:true,force:true});}
});

test('export rejects destination parent symlink resolving inside managed archives',async(t)=>{
 const q=await setup();
 try{
  const link=join(q.root,'looks-outside');
  try{await symlink(join(q.managedRoot,'managed','demo'),link,'junction');}
  catch(error){
   if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('Directory links unavailable');return;}
   throw error;
  }
  const redirected=join(link,'injected.user.js');
  await assert.rejects(
   exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',destinationPath:redirected}),
   /managed|resolved|directory/i,
  );
  await assert.rejects(readFile(join(q.managedRoot,'managed','demo','injected.user.js')),{code:'ENOENT'});
 }finally{await rm(q.root,{recursive:true,force:true});}
});

test('managed export reads current revisions through the pinned descriptor helper, never path-only readFile',async()=>{
 const {readFile:loadSource}=await import('node:fs/promises');
 const source=await loadSource(new URL('../src/export.ts',import.meta.url),'utf8');
 assert.match(source,/readPinnedRegularFile\(currentPath,\s*\{maxBytes:512\*1024,expected:info\}\)/);
 assert.doesNotMatch(source,/\bawait readFile\(currentPath\)/);
});

test('export refuses dot-dot PREFIX directories that actually reside inside the managed data root',async()=>{
 const q=await setup();
 try{
  const tucked=join(q.managedRoot,'..not-parent','new.user.js');
  await mkdir(join(q.managedRoot,'..not-parent'));
  await assert.rejects(
   exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',destinationPath:tucked}),
   /managed|inside|directory/i,
  );
  await assert.rejects(readFile(tucked),{code:'ENOENT'});
  assert.equal(await readFile(q.sourcePath,'utf8'),q.input);
 }finally{await rm(q.root,{recursive:true,force:true});}
});
test('export still permits a genuinely outside sibling with a dot-dot-prefixed directory name',async()=>{
 const q=await setup();
 try{
  const sibling=join(q.root,'..valid-destination');
  await mkdir(sibling);
  const path=join(sibling,'repaired.user.js');
  const out=await exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',destinationPath:path});
  assert.equal(out.path,path);
  assert.match(await readFile(path,'utf8'),/#new/);
 }finally{await rm(q.root,{recursive:true,force:true});}
});

test('atomic managed export stages multiple chunks and makes only fully flushed, verified bytes visible',async()=>{
 const q=await setup();
 try{
  const bytes=Buffer.alloc(160_000,0x43);
  let writes=0;
  await publishExclusiveExport({
   destinationPath:join(q.root,'large.user.js'),bytes,
   writeChunk:async(handle,chunk,position)=>{
    const {bytesWritten}=await handle.write(chunk,0,chunk.length,position);
    if(++writes===1)
     await assert.rejects(readFile(join(q.root,'large.user.js')),{code:'ENOENT'});
    return bytesWritten;
   },
  });
  assert.ok(writes>1);
  assert.deepEqual(await readFile(join(q.root,'large.user.js')),bytes);
  assert.equal((await readdir(q.root)).filter(x=>x.includes('.staging-')).length,0);
 }finally{await rm(q.root,{recursive:true,force:true});}
});

test('disk failure during managed export leaves no partial final output and cleans staging',async()=>{
 const q=await setup();
 try{
  let writes=0;
  await assert.rejects(publishExclusiveExport({
   destinationPath:q.destination,bytes:Buffer.alloc(150_000,0x51),
   writeChunk:async(handle,chunk,position)=>{
    if(++writes===2)throw Object.assign(new Error('simulated disk full'),{code:'ENOSPC'});
    return (await handle.write(chunk,0,chunk.length,position)).bytesWritten;
   },
  }),/disk full/i);
  assert.equal(writes,2);
  await assert.rejects(readFile(q.destination),{code:'ENOENT'});
  assert.equal((await readdir(q.root)).filter(x=>x.includes('.staging-')).length,0);
 }finally{await rm(q.root,{recursive:true,force:true});}
});

test('competing final output introduced after export staging cannot be overwritten',async()=>{
 const q=await setup();
 try{
  let called=0;
  await assert.rejects(publishExclusiveExport({
   destinationPath:q.destination,bytes:Buffer.from('verified export bytes'),
   beforePublish:async()=>{called++;await writeFile(q.destination,'competing user destination');},
  }),/exists|overwrite/i);
  assert.equal(called,1);
  assert.equal(await readFile(q.destination,'utf8'),'competing user destination');
  assert.equal((await readdir(q.root)).filter(x=>x.includes('.staging-')).length,0);
 }finally{await rm(q.root,{recursive:true,force:true});}
});

test('an active managed writer lock blocks a new export without creating a destination',async()=>{
 const q=await setup();
 try{
  const current=join(q.managedRoot,'managed','demo','current.user.js');
  await mkdir(current+'.write-lock');
  await assert.rejects(exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',
   destinationPath:q.destination}),/lock|busy|writer|in progress/i);
  await assert.rejects(readFile(q.destination),{code:'ENOENT'});
 }finally{await rm(q.root,{recursive:true,force:true});}
});

test('export holds the managed current lease through atomic destination publish',async()=>{
 const q=await setup();
 try{
  const current=join(q.managedRoot,'managed','demo','current.user.js');
  let checked=false;
  const output=await exportManagedCurrent({managedRoot:q.managedRoot,scriptId:'demo',
   destinationPath:q.destination,
   beforePublish:async()=>{
    checked=true;
    await assert.rejects(commitManagedCurrent({
     activePath:current,bytes:Buffer.from('competing newer managed revision'),
     expectedActiveHash:q.receipt.hash,
    }),/lock|writer|busy|in progress/i);
    await assert.rejects(readFile(q.destination),{code:'ENOENT'});
   },
  });
  assert.equal(checked,true);
  assert.equal(output.hash,q.receipt.hash);
  assert.deepEqual(await readFile(q.destination),await readFile(current));
  assert.ok(!(await readdir(join(q.managedRoot,'managed','demo'))).includes('current.user.js.write-lock'));
 }finally{await rm(q.root,{recursive:true,force:true});}
});
