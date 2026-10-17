import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {approveManagedRollback} from '../src/main/approved-rollback.ts';
import {activateManagedRevision} from '../../../packages/repair-workflow/src/history.ts';
import {inspectManagedIntegrity} from '../../../packages/repair-workflow/src/managed-health.ts';

const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const inventory=()=>[{hash:A,verified:true},{hash:B,verified:true}];
const inspect=async()=>({status:'healthy' as const,activeHash:A,archiveCount:2});

test('FR-028 ignores renderer approved:true until Main native consent actually confirms',async()=>{
 let wrote=false,confirmed=0;
 await assert.rejects(approveManagedRollback({
  targetHash:B,inspect,list:async()=>inventory(),assertCurrent:()=>{},
  confirm:async()=>{confirmed++;return {response:0};},
  restore:async()=>{wrote=true;return {hash:B,activePath:'not-expected'};},
 }),/not approved|cancel/i);
 assert.equal(confirmed,1);
 assert.equal(wrote,false);
});

test('FR-028 pins the reviewed predecessor hash through Main revalidation and CAS restore',async()=>{
 let observations=0,assertions=0,restored:string|null='';
 const result=await approveManagedRollback({
  targetHash:B,
  inspect:async()=>{observations++;return inspect();},
  list:async()=>inventory(),
  assertCurrent:()=>{assertions++;},
  confirm:async review=>{
   assert.deepEqual(review,{currentHash:A,targetHash:B});
   return {response:1};
  },
  restore:async expectedCurrentHash=>{
   restored=expectedCurrentHash;
   return {hash:B,activePath:'synthetic-managed-current'};
  },
 });
 assert.equal(result.hash,B);
 assert.equal(restored,A);
 assert.equal(observations,2,'native review must be bound to fresh identity after waiting');
 assert.ok(assertions>=2,'live trusted scan must be revalidated before mutation');
});

test('FR-028 refuses wrong targets and damaged or locked current before showing a confirmation',async()=>{
 for(const [status,target,inventoryValue] of [
  ['write-locked',B,inventory()],
  ['unsafe',B,inventory()],
  ['healthy',C,inventory()],
  ['healthy',A,inventory()],
 ] as const){
  let confirmations=0;
  await assert.rejects(approveManagedRollback({
   targetHash:target,
   inspect:async()=>({status,activeHash:A,archiveCount:2}),
   list:async()=>inventoryValue,
   assertCurrent:()=>{},
   confirm:async()=>{confirmations++;return {response:1};},
   restore:async()=>{throw Error('must never mutate');},
  }),/unsafe|healthy|available|unchanged|revision|current|selected|target/i);
  assert.equal(confirmations,0,'invalid review state must fail before native consent');
 }
});

test('FR-028 safely recovers an absent managed current only with native consent and null CAS',async()=>{
 let expected:string|null='not-called',confirmed=0;
 const result=await approveManagedRollback({
  targetHash:B,
  inspect:async()=>({status:'missing-current',activeHash:null}),
  list:async()=>inventory(),assertCurrent:()=>{},
  confirm:async review=>{
   confirmed++;assert.deepEqual(review,{currentHash:null,targetHash:B});
   return {response:1};
  },
  restore:async currentHash=>{
   expected=currentHash;
   return {hash:B,activePath:'synthetic-recovered-current'};
  },
 });
 assert.equal(confirmed,1);
 assert.equal(expected,null);
 assert.equal(result.hash,B);
});

test('FR-028 rejects stale active revision or missing archive after native dialog',async()=>{
 let state=A,archives=inventory(),wrote=false;
 for(const stale of ['active','archive'] as const){
  state=A;archives=inventory();wrote=false;
  await assert.rejects(approveManagedRollback({
   targetHash:B,
   inspect:async()=>({status:'healthy',activeHash:state,archiveCount:2}),
   list:async()=>archives,
   assertCurrent:()=>{},
   confirm:async()=>{if(stale==='active')state=C;else archives=[{hash:A,verified:true}];return {response:1};},
   restore:async()=>{wrote=true;return {hash:B,activePath:'synthetic'};},
  }),/changed|stale|target|revision/i);
  assert.equal(wrote,false);
 }
});

test('FR-028 real immutable managed archive CAS rejects an intervening writer after the last read',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-approval-'));
 const scriptId='synthetic-script',folder=join(root,'managed',scriptId);
 const original='// SAFE ORIGINAL FILE\\n',old='// first managed version\\n',next='// concurrent managed version\\n';
 const digest=(data:string)=>createHash('sha256').update(data).digest('hex');
 const o=digest(original),a=digest(old),b=digest(next);
 try{
  await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'original-'+o+'.user.js'),original);
  await writeFile(join(folder,'revision-'+a+'.user.js'),old);
  await writeFile(join(folder,'revision-'+b+'.user.js'),next);
  await activateManagedRevision({managedRoot:root,scriptId,hash:a,approved:true});
  const inspect=()=>inspectManagedIntegrity({managedRoot:root,scriptId});
  await assert.rejects(approveManagedRollback({
   targetHash:o,inspect,
   list:()=>import('../../../packages/repair-workflow/src/history.ts').then(m=>m.listManagedRevisions({managedRoot:root,scriptId})),
   assertCurrent:()=>{},confirm:async()=>({response:1}),
   restore:async expectedCurrentHash=>{
    await activateManagedRevision({managedRoot:root,scriptId,hash:b,approved:true,expectedCurrentHash:a});
    return activateManagedRevision({managedRoot:root,scriptId,hash:o,approved:true,expectedCurrentHash});
   },
  }),/changed|stale|refusing/i);
  assert.equal(await readFile(join(folder,'current.user.js'),'utf8'),next);
  assert.equal(await readFile(join(folder,'original-'+o+'.user.js'),'utf8'),original);
  // Recovery from a missing current is permitted, but a new current appearing
  // AFTER the final read must be rejected under the same null compare-and-swap.
  await rm(join(folder,'current.user.js'));
  await assert.rejects(approveManagedRollback({
   targetHash:o,inspect,
   list:()=>import('../../../packages/repair-workflow/src/history.ts').then(m=>m.listManagedRevisions({managedRoot:root,scriptId})),
   assertCurrent:()=>{},confirm:async()=>({response:1}),
   restore:async expectedCurrentHash=>{
    assert.equal(expectedCurrentHash,null);
    await activateManagedRevision({managedRoot:root,scriptId,hash:a,approved:true});
    return activateManagedRevision({managedRoot:root,scriptId,hash:o,approved:true,expectedCurrentHash});
   },
  }),/appeared|changed|stale|refusing/i);
  assert.equal(await readFile(join(folder,'current.user.js'),'utf8'),old);
  assert.equal(await readFile(join(folder,'original-'+o+'.user.js'),'utf8'),original);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-028 Electron Main uses the consent and CAS guard instead of calling restore directly from renderer approved',async()=>{
 const {readFile}=await import('node:fs/promises');
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:rollback-managed'");
 const end=main.indexOf("ipcMain.handle('usshm:export-dom-report'",start);
 assert.ok(start>=0&&end>start);
 const handler=main.slice(start,end);
 assert.match(handler,/approveManagedRollback\(\{/);
 assert.match(handler,/dialog\.showMessageBox\(mainWindow/);
 assert.match(handler,/expectedCurrentHash/);
 assert.doesNotMatch(handler,/return repairs\.restore\(\{scriptId:item\.scriptId,hash:q\.hash,approved:true\}\)/);
});
