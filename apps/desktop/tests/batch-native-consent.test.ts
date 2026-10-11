import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {approveAndApplyManagedRevision} from '../src/main/confirm-managed-apply.ts';
import {assertBatchProposalSnapshot} from '../src/main/confirm-batch-apply.ts';

test('real batch inspectPending shape rejects changes and declines without writes',async()=>{
 const reviewed={scriptId:'a',previousHash:'before',proposedHash:'after',selectorIndexes:[0,2]};
 for(const response of [0,2,-1,1]){
  for(const changed of ['none','scan','scriptId','previousHash','proposedHash','selectorIndexes']){
   let writes=0;
   const current={...reviewed,selectorIndexes:[...reviewed.selectorIndexes]};
   if(changed==='scriptId')current.scriptId='b';
   if(changed==='previousHash')current.previousHash='different';
   if(changed==='proposedHash')current.proposedHash='different';
   if(changed==='selectorIndexes')current.selectorIndexes.reverse();
   const run=()=>approveAndApplyManagedRevision({
    confirm:async()=>({response}),
    revalidate:()=>{
     if(changed==='scan')throw new Error('stale scan');
     assertBatchProposalSnapshot(reviewed,current);
    },
    apply:async()=>{writes++;return 'applied';},
   });
   if(response===1&&changed==='none')assert.equal(await run(),'applied');
   else await assert.rejects(run());
   assert.equal(writes,response===1&&changed==='none'?1:0);
  }
 }
});
test('both real batch IPC handlers require main confirmation before batchRepairs.applyBatch',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 for(const name of ['usshm:apply-batch-repair','usshm:apply-batch-repair-guarded']){
  const start=main.indexOf("ipcMain.handle('"+name+"'");
  const end=main.indexOf("ipcMain.handle('",start+12);
  assert.ok(start>=0&&end>start);
  const handler=main.slice(start,end);
  assert.match(handler,/await approveAndApplyManagedRevision\(/);
  assert.match(handler,/assertBatchProposalSnapshot\(/);
 }
});
