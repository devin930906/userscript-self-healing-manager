import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {confirmSingleManagedApply} from '../src/main/confirm-managed-apply.ts';

test('renderer approved:true is not sufficient without trusted native main approval',async()=>{
 let calls=0;
 const declined=await confirmSingleManagedApply(async()=>{calls++;return {response:0};});
 assert.equal(declined,false);
 assert.equal(calls,1);
 const dismissed=await confirmSingleManagedApply(async()=>({response:2}));
 assert.equal(dismissed,false);
 const accepted=await confirmSingleManagedApply(async()=>({response:1}));
 assert.equal(accepted,true);
});
test('real apply-repair IPC awaits main-native approval before repairs.apply',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const start=main.indexOf("ipcMain.handle('usshm:apply-repair'");
 const end=main.indexOf("ipcMain.handle('usshm:verify-managed-dom'",start);
 assert.ok(start>=0&&end>start);
 const handler=main.slice(start,end);
 const confirm=handler.indexOf('await approveAndApplyManagedRevision(');
 const apply=handler.indexOf('repairs.apply(');
 assert.ok(confirm>=0&&confirm<apply,'native main confirmation must precede managed apply');
 assert.match(handler,/assertManagedProposalSnapshot\(/);
});

test('guarded apply IPC must use executable approval gate before write',async()=>{
 const {approveAndApplyManagedRevision}=await import('../src/main/confirm-managed-apply.ts');
 let writes=0;
 const deps={confirm:async()=>({response:0}),revalidate:()=>{},apply:async()=>{writes++;return 'applied';}};
 await assert.rejects(approveAndApplyManagedRevision(deps),/not approved/);
 assert.equal(writes,0);
});

test('guarded managed write gate rejects dismissal and stale checks without calling apply',async()=>{
 const {approveAndApplyManagedRevision}=await import('../src/main/confirm-managed-apply.ts');
 for(const response of [0,2,-1]){
  let applied=0;
  await assert.rejects(approveAndApplyManagedRevision({
   confirm:async()=>({response}),revalidate:()=>{},apply:async()=>{applied++;return 1;},
  }),/not approved/);
  assert.equal(applied,0);
 }
 for(const phase of ['scan','proposal']){
  let applied=0;
  await assert.rejects(approveAndApplyManagedRevision({
   confirm:async()=>({response:1}),
   revalidate:()=>{throw new Error('stale '+phase);},
   apply:async()=>{applied++;return 1;},
  }),/stale/);
  assert.equal(applied,0);
 }
});
test('guarded managed write gate applies only after confirmation and revalidation',async()=>{
 const {approveAndApplyManagedRevision}=await import('../src/main/confirm-managed-apply.ts');
 const order:string[]=[];
 const result=await approveAndApplyManagedRevision({
  confirm:async()=>{order.push('confirm');return {response:1};},
  revalidate:()=>{order.push('scan-and-proposal');},
  apply:async()=>{order.push('apply');return 'ok';},
 });
 assert.equal(result,'ok');
 assert.deepEqual(order,['confirm','scan-and-proposal','apply']);
});
test('guarded real IPC executes approval gate ahead of managed write',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const start=main.indexOf("ipcMain.handle('usshm:apply-repair-guarded'");
 const end=main.indexOf("ipcMain.handle('usshm:apply-repair'",start);
 assert.ok(start>=0&&end>start);
 const handler=main.slice(start,end);
 assert.match(handler,/await approveAndApplyManagedRevision\(/);
 assert.match(handler,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.match(handler,/pendingApprovals\.require\(q\.proposalId,scanSnapshot\.scanId\)/);
});

test('actual inspectPending shape is approved only when native consent and snapshot still match',async()=>{
 const {approveAndApplyManagedRevision,assertManagedProposalSnapshot}=await import('../src/main/confirm-managed-apply.ts');
 const original={scriptId:'script',proposedHash:'new-sha',previousHash:'old-sha',newSelector:'.new'};
 const current={...original};
 let writes=0;
 const run=async(response:number,mutate:()=>void=()=>{},scanValid=true)=>{
  Object.assign(current,original);
  return approveAndApplyManagedRevision({
   confirm:async()=>{mutate();return {response};},
   revalidate:()=>{
    if(!scanValid)throw new Error('stale scan');
    assertManagedProposalSnapshot(original,current);
   },
   apply:async()=>{writes++;return 'applied';},
  });
 };
 for(const response of [0,2,-1]){
  writes=0;
  await assert.rejects(run(response),/not approved/);
  assert.equal(writes,0);
 }
 for(const key of ['scriptId','proposedHash','previousHash','newSelector'] as const){
  writes=0;
  await assert.rejects(run(1,()=>{current[key]='changed';}),/proposal.*changed/i);
  assert.equal(writes,0,key);
 }
 writes=0;
 await assert.rejects(run(1,()=>{},false),/stale scan/);
 assert.equal(writes,0);
 writes=0;
 assert.equal(await run(1),'applied');
 assert.equal(writes,1);
});
