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
 assert.equal(await readFile(appliedOne.backupPath,'utf8'),original,'the original archive remains immutable');
 assert.equal(await readFile(appliedTwo.backupPath,'utf8'),await readFile(appliedOne.managedPath,'utf8'),'second backup is the prior managed revision');
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

test('second repair targets original AST call after earlier same-line replacement shifts its column',async()=>withSource(async(sourcePath,managedRoot)=>{
 const original='document.querySelector("#first");document.querySelector("#second");\n';
 await writeFile(sourcePath,original);
 const flow=createRepairWorkflow({managedRoot});
 const initialSecondColumn=original.indexOf('document.querySelector("#second")')+1;
 const first=await flow.propose({sourcePath,scriptId:'shifted',oldSelector:'#first',
  newSelector:'#first-replacement-with-a-longer-name',
  selectorLocation:{method:'querySelector',line:1,column:1}});
 await flow.apply({proposalId:first.proposalId,approved:true});
 const second=await flow.propose({sourcePath,scriptId:'shifted',oldSelector:'#second',newSelector:'#second-fixed',
  selectorLocation:{method:'querySelector',line:1,column:initialSecondColumn}});
 const applied=await flow.apply({proposalId:second.proposalId,approved:true});
 assert.equal(await readFile(applied.managedPath,'utf8'),
  'document.querySelector("#first-replacement-with-a-longer-name");document.querySelector("#second-fixed");\n');
 assert.equal(await readFile(sourcePath,'utf8'),original);
}));

test('proposal receipt tracks immutable original hash separately from active managed revision hash',async()=>withSource(async(sourcePath,managedRoot)=>{
 const original='document.querySelector("#first");\ndocument.querySelector("#second");\n';
 await writeFile(sourcePath,original);
 const flow=createRepairWorkflow({managedRoot});
 const crypto=await import('node:crypto');
 const originalHash=crypto.createHash('sha256').update(original).digest('hex');
 const first=await flow.propose({sourcePath,scriptId:'receipt-chain',oldSelector:'#first',newSelector:'#repaired-first'});
 assert.equal(first.originalHash,originalHash);
 assert.equal(first.baseHash,originalHash);
 const firstApplied=await flow.apply({proposalId:first.proposalId,approved:true});
 const second=await flow.propose({sourcePath,scriptId:'receipt-chain',oldSelector:'#second',newSelector:'#repaired-second'});
 assert.equal(second.originalHash,originalHash,'source scan identity remains the original byte hash');
 assert.equal(second.baseHash,firstApplied.hash,'patch base must be the verified active managed version');
 assert.notEqual(second.baseHash,second.originalHash,'second managed patch must not be rejected as changed original');
 const secondApplied=await flow.apply({proposalId:second.proposalId,approved:true});
 assert.match(await readFile(secondApplied.managedPath,'utf8'),/#repaired-first/);
 assert.match(await readFile(secondApplied.managedPath,'utf8'),/#repaired-second/);
 assert.equal(await readFile(sourcePath,'utf8'),original);
}));

test('stale proposal made before first activation cannot silently replace a newer managed revision',async()=>withSource(async(sourcePath,managedRoot)=>{
 const original='document.querySelector("#first-old");\ndocument.querySelector("#second-old");\n';
 await writeFile(sourcePath,original);
 const flow=createRepairWorkflow({managedRoot});
 const first=await flow.propose({sourcePath,scriptId:'proposal-conflict',oldSelector:'#first-old',newSelector:'#first-new'});
 const staleSecond=await flow.propose({sourcePath,scriptId:'proposal-conflict',oldSelector:'#second-old',newSelector:'#second-new'});
 const firstApplied=await flow.apply({proposalId:first.proposalId,approved:true});
 const current=join(managedRoot,'managed','proposal-conflict','current.user.js');
 const approvedContent=await readFile(current,'utf8');
 assert.match(approvedContent,/#first-new/);
 assert.equal(flow.inspectPending(staleSecond.proposalId),null,'successful activation revokes sibling previews');
 await assert.rejects(flow.apply({proposalId:staleSecond.proposalId,approved:true}),/stale|changed|active|revision|conflict|not found|already applied/i);
 assert.equal(await readFile(current,'utf8'),approvedContent,'an old preview must not discard newer approved work');
 assert.equal(await readFile(sourcePath,'utf8'),original);
 const fresh=await flow.propose({sourcePath,scriptId:'proposal-conflict',oldSelector:'#second-old',newSelector:'#second-new'});
 const secondApplied=await flow.apply({proposalId:fresh.proposalId,approved:true});
 assert.match(await readFile(secondApplied.managedPath,'utf8'),/#first-new/);
 assert.match(await readFile(secondApplied.managedPath,'utf8'),/#second-new/);
 assert.equal(firstApplied.hash!==secondApplied.hash,true);
}));

test('simultaneous approvals for the same script cannot both overwrite active managed work',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const first=await flow.propose({sourcePath,scriptId:'concurrent',oldSelector:'#old',newSelector:'#one'});
 const second=await flow.propose({sourcePath,scriptId:'concurrent',oldSelector:'#old',newSelector:'#two'});
 const outcomes=await Promise.allSettled([
  flow.apply({proposalId:first.proposalId,approved:true}),
  flow.apply({proposalId:second.proposalId,approved:true}),
 ]);
 const approved=outcomes.filter(x=>x.status==='fulfilled');
 const refused=outcomes.filter(x=>x.status==='rejected');
 assert.equal(approved.length,1,'exactly one approval may commit while another is in progress');
 assert.equal(refused.length,1);
 const current=await readFile(join(managedRoot,'managed','concurrent','current.user.js'),'utf8');
 const winner=(approved[0] as PromiseFulfilledResult<{hash:string;managedPath:string}>).value;
 assert.equal(current,await readFile(winner.managedPath,'utf8'));
 assert.match(current,/#one|#two/);
 assert.match(await readFile(sourcePath,'utf8'),/#old/);
}));

test('a completed rescan invalidates unpublished repair previews and frees their bounded memory',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 for(let i=0;i<100;i++){
  await flow.propose({sourcePath,scriptId:'clear-pending',oldSelector:'#old',newSelector:'#fixed-'+i});
 }
 await assert.rejects(flow.propose({sourcePath,scriptId:'clear-pending',oldSelector:'#old',newSelector:'#overflow'}),/too many|limit/i);
 flow.invalidatePending();
 const fresh=await flow.propose({sourcePath,scriptId:'clear-pending',oldSelector:'#old',newSelector:'#post-rescan'});
 const applied=await flow.apply({proposalId:fresh.proposalId,approved:true});
 assert.match(await readFile(applied.managedPath,'utf8'),/#post-rescan/);
}));
test('an old repair preview cannot be applied after its scan is invalidated',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const old=await flow.propose({sourcePath,scriptId:'invalidated',oldSelector:'#old',newSelector:'#old-preview'});
 flow.invalidatePending();
 await assert.rejects(flow.apply({proposalId:old.proposalId,approved:true}),/not found|stale|invalid/i);
 assert.match(await readFile(sourcePath,'utf8'),/#old/);
}));


test('restore cannot race an in-progress repair approval and may proceed after it completes',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const sourceBefore=await readFile(sourcePath);
 const first=await flow.propose({sourcePath,scriptId:'restore-race',oldSelector:'#old',newSelector:'#fixed'});
 const applying=flow.apply({proposalId:first.proposalId,approved:true});
 // apply takes the per-script write lock before its first async filesystem operation.
 // A rollback racing with it must refuse instead of replacing current.user.js.
 await assert.rejects(flow.restore({scriptId:'restore-race',hash:first.originalHash,approved:true}),/in progress|another|busy/i);
 const applied=await applying;
 assert.match(await readFile(join(managedRoot,'managed','restore-race','current.user.js'),'utf8'),/#fixed/);
 const restored=await flow.restore({scriptId:'restore-race',hash:first.originalHash,approved:true});
 assert.equal(restored.hash,first.originalHash);
 assert.deepEqual(await readFile(restored.activePath),sourceBefore);
 assert.deepEqual(await readFile(sourcePath),sourceBefore,'the original must never be overwritten');
 assert.match(await readFile(applied.managedPath,'utf8'),/#fixed/,'the approved archived revision must remain recoverable');
}));

test('a stale CDP preview is revocable without clearing unrelated reviewed proposals',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const old=await flow.propose({sourcePath,scriptId:'script01',oldSelector:'#old',newSelector:'#first'});
 const newer=await flow.propose({sourcePath,scriptId:'script01',oldSelector:'#old',newSelector:'#second'});
 assert.equal(flow.discard(old.proposalId),true);
 assert.equal(flow.discard(old.proposalId),false);
 await assert.rejects(flow.apply({proposalId:old.proposalId,approved:true}),/not found|stale|applied/i);
 const applied=await flow.apply({proposalId:newer.proposalId,approved:true});
 assert.match(await readFile(applied.managedPath,'utf8'),/#second/);
}));

test('guarded apply reads the predecessor identity from Main-owned pending draft, not renderer-provided SHA',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const proposal=await flow.propose({sourcePath,scriptId:'script01',oldSelector:'#old',newSelector:'#guarded'});
 const trusted=flow.inspectPending(proposal.proposalId);
 assert.deepEqual(trusted,{scriptId:'script01',previousHash:proposal.baseHash,proposedHash:proposal.proposedHash,newSelector:'#guarded'});
 assert.equal(flow.inspectPending('non-existent'),null);
 await flow.apply({proposalId:proposal.proposalId,approved:true});
 assert.equal(flow.inspectPending(proposal.proposalId),null,'applied proposal must no longer grant stale approval metadata');
}));

test('automatic rollback must not overwrite another already approved managed revision',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const firstProposal=await flow.propose({sourcePath,scriptId:'script01',oldSelector:'#old',newSelector:'#first'});
 const first=await flow.apply({proposalId:firstProposal.proposalId,approved:true});
 const secondProposal=await flow.propose({sourcePath,scriptId:'script01',oldSelector:'#first',newSelector:'#second'});
 const second=await flow.apply({proposalId:secondProposal.proposalId,approved:true});
 const {createHash}=await import('node:crypto');
 const before=createHash('sha256').update(await readFile(join(managedRoot,'managed','script01','current.user.js'))).digest('hex');
 assert.equal(before,second.hash);
 await assert.rejects(flow.restore({scriptId:'script01',hash:firstProposal.baseHash,
  approved:true,expectedCurrentHash:first.hash}),/current|concurrent|stale|changed|hash/i);
 assert.equal(createHash('sha256').update(await readFile(join(managedRoot,'managed','script01','current.user.js'))).digest('hex'),second.hash);
}));


test('successful repair invalidates sibling proposals for the same script',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const first=await flow.propose({sourcePath,scriptId:'siblings',oldSelector:'#old',newSelector:'#first'});
 const second=await flow.propose({sourcePath,scriptId:'siblings',oldSelector:'#old',newSelector:'#second'});
 await flow.apply({proposalId:first.proposalId,approved:true});
 assert.equal(flow.inspectPending(second.proposalId),null);
 await assert.rejects(flow.apply({proposalId:second.proposalId,approved:true}),/not found|already applied/i);
}));

test('successful managed rollback invalidates obsolete proposed repairs',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const initial=await flow.propose({sourcePath,scriptId:'rollback-script',oldSelector:'#old',newSelector:'#new'});
 const applied=await flow.apply({proposalId:initial.proposalId,approved:true});
 const staged=await flow.propose({sourcePath,scriptId:'rollback-script',oldSelector:'#new',newSelector:'#future'});
 assert.ok(flow.inspectPending(staged.proposalId));
 const original=await readFile(sourcePath);
 const {createHash}=await import('node:crypto');
 const originalHash=createHash('sha256').update(original).digest('hex');
 await flow.restore({scriptId:'rollback-script',hash:originalHash,approved:true,expectedCurrentHash:applied.hash});
 assert.equal(flow.inspectPending(staged.proposalId),null);
 await assert.rejects(flow.apply({proposalId:staged.proposalId,approved:true}),/not found|already applied/i);
}));


test('scan invalidation clears staged approvals while allowing fresh scan proposals',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const stale=await flow.propose({sourcePath,scriptId:'epoch-invalidation',oldSelector:'#old',newSelector:'#stale'});
 assert.ok(flow.inspectPending(stale.proposalId));
 flow.invalidatePending();
 assert.equal(flow.inspectPending(stale.proposalId),null);
 await assert.rejects(flow.apply({proposalId:stale.proposalId,approved:true}),/not found|already applied/i);
 const fresh=await flow.propose({sourcePath,scriptId:'epoch-invalidation',oldSelector:'#old',newSelector:'#fresh'});
 assert.ok(flow.inspectPending(fresh.proposalId));
 const applied=await flow.apply({proposalId:fresh.proposalId,approved:true});
 assert.match(await readFile(applied.managedPath,'utf8'),/#fresh/);
}));


test('explicit discarded approval cannot be applied, while a new proposal remains possible',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const obsolete=await flow.propose({sourcePath,scriptId:'discarded',oldSelector:'#old',newSelector:'#obsolete'});
 assert.equal(flow.discard(obsolete.proposalId),true);
 assert.equal(flow.inspectPending(obsolete.proposalId),null);
 await assert.rejects(flow.apply({proposalId:obsolete.proposalId,approved:true}),/not found|already applied/i);
 const fresh=await flow.propose({sourcePath,scriptId:'discarded',oldSelector:'#old',newSelector:'#fresh'});
 const applied=await flow.apply({proposalId:fresh.proposalId,approved:true});
 assert.match(await readFile(applied.managedPath,'utf8'),/#fresh/);
}));


test('discarding one approval preserves unrelated scripts pending approvals',async()=>withSource(async(sourcePath,managedRoot)=>{
 const flow=createRepairWorkflow({managedRoot});
 const a=await flow.propose({sourcePath,scriptId:'separate-a',oldSelector:'#old',newSelector:'#a'});
 const b=await flow.propose({sourcePath,scriptId:'separate-b',oldSelector:'#old',newSelector:'#b'});
 assert.equal(flow.discard(a.proposalId),true);
 assert.equal(flow.inspectPending(a.proposalId),null);
 assert.ok(flow.inspectPending(b.proposalId));
 const result=await flow.apply({proposalId:b.proposalId,approved:true});
 assert.match(await readFile(result.managedPath,'utf8'),/#b/);
}));
