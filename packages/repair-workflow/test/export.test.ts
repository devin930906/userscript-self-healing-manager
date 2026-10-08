import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRepairWorkflow} from '../src/index.ts';
import {exportManagedCurrent} from '../src/export.ts';

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
 }finally{await rm(q.root,{recursive:true,force:true});}
});
