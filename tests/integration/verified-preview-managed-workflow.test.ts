import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRepairWorkflow} from '../../packages/repair-workflow/src/index.ts';
import {prepareVerifiedRepairPreview} from '../../packages/repair-workflow/src/verified-preview.ts';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
test('verified single DOM candidate goes through preview to a separate explicitly approved managed revision',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-verified-managed-'));
 const sourcePath=join(dir,'original.user.js'),managedRoot=join(dir,'Data');
 const original=Buffer.from('// ==UserScript==\n// @name Synthetic\n// ==/UserScript==\ndocument.querySelector("#old");\n');
 await writeFile(sourcePath,original);
 try{
  const flow=createRepairWorkflow({managedRoot});
  const target={id:'fixture-cdp',url:'http://127.0.0.1:45678/fixture'};
  const locator={method:'querySelector',expression:'#old',runtimeRequired:false};
  const output=await prepareVerifiedRepairPreview({approved:true,target,locator,
   source:{scriptId:'fixture-safe',sourcePath,expectedSha256:sha(original),
    selectorLocation:{method:'querySelector',line:4,column:1}},
   deps:{
    confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'main',loaderId:'stable'}),
    discover:async()=>[{expression:'#uniqueButton',cssSelector:'#uniqueButton',source:'DOMSnapshot',
     matchCount:1,confidenceScore:80,evidence:'synthetic-dom',validationLevel:'dom-candidate-verified',approved:false}],
    verifySource:async()=>{assert.equal(sha(await readFile(sourcePath)),sha(original));},
    propose:selector=>flow.propose({sourcePath,scriptId:'fixture-safe',oldSelector:locator.expression,
     newSelector:selector,selectorLocation:{method:'querySelector',line:4,column:1}}),
    revoke:id=>{flow.discard(id);},
   },
  });
  assert.equal(output.status,'prepared');
  assert.equal(output.V3,'not-configured');
  assert.ok(output.proposal);
  const current=join(managedRoot,'managed','fixture-safe','current.user.js');
  await assert.rejects(lstat(current),{code:'ENOENT'});
  assert.deepEqual(await readFile(sourcePath),original);
  await assert.rejects(flow.apply({proposalId:output.proposal!.proposalId,approved:false}),/approval/i);
  const saved=await flow.apply({proposalId:output.proposal!.proposalId,approved:true});
  assert.equal(sha(await readFile(saved.managedPath)),saved.hash);
  assert.match(await readFile(current,'utf8'),/querySelector\("#uniqueButton"\)/);
  assert.deepEqual(await readFile(sourcePath),original);
  // A managed revision is recoverable to the exact archived original while
  // the unmodified external .user.js retains its initial bytes.
  const restored=await flow.restore({scriptId:'fixture-safe',hash:sha(original),approved:true});
  assert.equal(restored.hash,sha(original));
  assert.deepEqual(await readFile(current),original);
  assert.deepEqual(await readFile(sourcePath),original);
  assert.match(await readFile(saved.managedPath,'utf8'),/querySelector\("#uniqueButton"\)/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('same-URL Chrome reload after creating proposal revokes its approval and leaves no managed current',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-stale-managed-'));
 const sourcePath=join(dir,'original.user.js'),managedRoot=join(dir,'Data');
 const original=Buffer.from('document.querySelector("#old");\n');
 await writeFile(sourcePath,original);
 try{
  const flow=createRepairWorkflow({managedRoot}),target={id:'fixture',url:'https://example.org/'};
  let calls=0,proposalId='';
  await assert.rejects(prepareVerifiedRepairPreview({approved:true,target,
   locator:{method:'querySelector',expression:'#old',runtimeRequired:false},
   source:{scriptId:'stale',sourcePath,expectedSha256:sha(original),
    selectorLocation:{method:'querySelector',line:1,column:1}},
   deps:{
    confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'main',loaderId:++calls===3?'reloaded':'original'}),
    discover:async()=>[{expression:'#new',cssSelector:'#new',source:'DOMSnapshot',
     matchCount:1,confidenceScore:75,evidence:'synthetic',validationLevel:'dom-candidate-verified',approved:false}],
    verifySource:async()=>{assert.equal(sha(await readFile(sourcePath)),sha(original));},
    propose:async selector=>{
     const r=await flow.propose({sourcePath,scriptId:'stale',oldSelector:'#old',newSelector:selector});
     proposalId=r.proposalId;return r;
    },
    revoke:id=>{flow.discard(id);},
   },
  }),/document|identity|reload|loader/i);
  assert.ok(proposalId);
  await assert.rejects(flow.apply({proposalId,approved:true}),/not found|stale|already/i);
  await assert.rejects(lstat(join(managedRoot,'managed','stale','current.user.js')),{code:'ENOENT'});
  assert.deepEqual(await readFile(sourcePath),original);
 }finally{await rm(dir,{recursive:true,force:true});}
});
