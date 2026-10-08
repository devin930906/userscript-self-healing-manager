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
