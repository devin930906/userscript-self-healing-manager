import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createRepairWorkflow} from '../src/index.ts';
async function withSource(run:(sourcePath:string,managedRoot:string)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'usshm-workflow-'));const sourcePath=join(dir,'demo.user.js');
 await writeFile(sourcePath,'// ==UserScript==\n// @name Test\n// ==/UserScript==\nconst element=document.querySelector("#old");\n');
 try{await run(sourcePath,join(dir,'managed-root'));}finally{await rm(dir,{recursive:true,force:true});}
}
test('two-phase patch saves managed copy and preserves original bytes',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});const original=await readFile(sourcePath);
 const proposal=await flow.propose({sourcePath,oldSelector:'#old',newSelector:'#new',scriptId:'script01'});
 assert.equal(proposal.oldSelector,'#old');assert.equal(proposal.newSelector,'#new');
 assert.match(proposal.preview,/#new/);
 assert.deepEqual(await readFile(sourcePath),original);
 const receipt=await flow.apply({proposalId:proposal.proposalId,approved:true});
 assert.match(await readFile(receipt.managedPath,'utf8'),/#new/);
 assert.deepEqual(await readFile(receipt.backupPath),original);
 assert.deepEqual(await readFile(sourcePath),original);
 await assert.rejects(flow.apply({proposalId:proposal.proposalId,approved:true}),/not found|already applied/i);
}));
test('requires approval and rejects unknown patch ids',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const proposal=await flow.propose({sourcePath,oldSelector:'#old',newSelector:'#new',scriptId:'a'});
 await assert.rejects(flow.apply({proposalId:proposal.proposalId,approved:false}),/approval/i);
 await assert.rejects(flow.apply({proposalId:'fake',approved:true}),/not found/i);
 const receipt=await flow.apply({proposalId:proposal.proposalId,approved:true});
 assert.ok((await stat(receipt.managedPath)).isFile());
}));
test('external edit between proposal and apply blocks stale patch',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const proposal=await flow.propose({sourcePath,oldSelector:'#old',newSelector:'#new',scriptId:'a'});
 await writeFile(sourcePath,'document.querySelector("#changed-by-someone-else")');
 await assert.rejects(flow.apply({proposalId:proposal.proposalId,approved:true}),/hash mismatch/i);
 assert.match(await readFile(sourcePath,'utf8'),/#changed-by-someone-else/);
}));
test('rejects unsafe source and oversized selectors',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 await assert.rejects(flow.propose({sourcePath,oldSelector:'#old',newSelector:'x'.repeat(1025),scriptId:'a'}),/short|selector/i);
 await assert.rejects(flow.propose({sourcePath:managedRoot,oldSelector:'#old',newSelector:'#new',scriptId:'a'}));
}));

test('applying a reviewed patch updates the managed current copy, never source',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});const original=await readFile(sourcePath);
 const proposal=await flow.propose({sourcePath,scriptId:'safe-script',oldSelector:'#old',newSelector:'#now'});
 const receipt=await flow.apply({proposalId:proposal.proposalId,approved:true});
 assert.match(await readFile(join(managedRoot,'managed','safe-script','current.user.js'),'utf8'),/#now/);
 assert.equal(await readFile(receipt.managedPath,'utf8'),await readFile(join(managedRoot,'managed','safe-script','current.user.js'),'utf8'));
 assert.deepEqual(await readFile(sourcePath),original);
}));

test('workflow can target the second repeated selector without changing first occurrence',async()=>withSource(async(sourcePath,managedRoot)=>{
 await writeFile(sourcePath,'document.querySelector("#old");\ndocument.querySelector("#old");\n');
 const flow=createRepairWorkflow({managedRoot});
 const p=await flow.propose({sourcePath,scriptId:'duplicated',oldSelector:'#old',newSelector:'#new',selectorLocation:{method:'querySelector',line:2,column:1}});
 const receipt=await flow.apply({proposalId:p.proposalId,approved:true});
 assert.equal(await readFile(receipt.managedPath,'utf8'),'document.querySelector("#old");\ndocument.querySelector("#new");\n');
 assert.equal(await readFile(sourcePath,'utf8'),'document.querySelector("#old");\ndocument.querySelector("#old");\n');
}));

test('successive fixes accumulate on verified managed current without erasing earlier changes',async()=>withSource(async(sourcePath,managedRoot)=>{
 const original='document.querySelector("#first-old");\ndocument.querySelector("#second-old");\n';
 await writeFile(sourcePath,original);
 const flow=createRepairWorkflow({managedRoot});
 const first=await flow.propose({sourcePath,scriptId:'multi-fix',oldSelector:'#first-old',newSelector:'#first-new'});
 const appliedOne=await flow.apply({proposalId:first.proposalId,approved:true});
 const second=await flow.propose({sourcePath,scriptId:'multi-fix',oldSelector:'#second-old',newSelector:'#second-new'});
 const appliedTwo=await flow.apply({proposalId:second.proposalId,approved:true});
 const current=await readFile(join(managedRoot,'managed','multi-fix','current.user.js'),'utf8');
 assert.equal(current,'document.querySelector("#first-new");\ndocument.querySelector("#second-new");\n');
 assert.equal(await readFile(sourcePath,'utf8'),original);
 assert.match(await readFile(appliedOne.managedPath,'utf8'),/#first-new/);
 assert.doesNotMatch(await readFile(appliedOne.managedPath,'utf8'),/#second-new/);
 assert.equal(await readFile(appliedTwo.managedPath,'utf8'),current);
 assert.equal(await readFile(appliedTwo.backupPath,'utf8'),original,'the original archive remains the actual original');
}));
test('second repair refuses externally edited managed current rather than discarding its changes',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const first=await flow.propose({sourcePath,scriptId:'external-change',oldSelector:'#old',newSelector:'#first'});
 await flow.apply({proposalId:first.proposalId,approved:true});
 const current=join(managedRoot,'managed','external-change','current.user.js');
 await writeFile(current,'document.querySelector("#private-unarchived");\n');
 await assert.rejects(flow.propose({sourcePath,scriptId:'external-change',oldSelector:'#private-unarchived',newSelector:'#second'}),/unmanaged|unverified|external/i);
 assert.equal(await readFile(current,'utf8'),'document.querySelector("#private-unarchived");\n');
}));
test('second repair blocks changed original before writing another revision',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const first=await flow.propose({sourcePath,scriptId:'changed-source',oldSelector:'#old',newSelector:'#first'});
 await flow.apply({proposalId:first.proposalId,approved:true});
 await writeFile(sourcePath,'document.querySelector("#changed-original");\n');
 await assert.rejects(flow.propose({sourcePath,scriptId:'changed-source',oldSelector:'#first',newSelector:'#second'}),/original|source|hash/i);
}));
