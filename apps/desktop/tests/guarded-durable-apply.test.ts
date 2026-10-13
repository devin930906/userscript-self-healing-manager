import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {executeDurableGuardedManagedApply} from '../src/main/guarded-durable-apply.ts';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
async function fixture(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-guarded-approval-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}

test('FR-029 guarded V1 managed write cannot remain active after post-write journal cleanup failure',async()=>fixture(async root=>{
 const activePath=join(root,'managed.user.js');
 const before='verified old managed revision',after='new managed revision awaiting V1';
 const oldHash=digest(before),newHash=digest(after);
 await writeFile(activePath,before);
 let writes=0,rollbacks=0;
 let message='';
 try{
  await executeDurableGuardedManagedApply({
   dataRoot:root,approvalId:randomUUID(),scriptId:'guarded-safe',
   previousHash:oldHash,
   preflight:()=>true,
   write:async()=>{writes++;await writeFile(activePath,after);return {hash:newHash};},
   restore:async expectedCurrentHash=>{
    rollbacks++;
    assert.equal(expectedCurrentHash,newHash,'never restore over another active revision');
    assert.equal(digest(await readFile(activePath,'utf8')),newHash);
    await writeFile(activePath,before);
    return {hash:oldHash,activePath};
   },
   // A failure after the committed write must never bypass post-write V1 safety.
   onRegisterCancel:()=>()=>{throw new Error('PRIVATE_JOURNAL_CLEANUP_DETAILS');},
  });
 }catch(error){message=String((error as Error).message);}
 assert.equal(writes,1);
 assert.equal(rollbacks,1);
 assert.equal(await readFile(activePath,'utf8'),before,'unverified managed bytes cannot be retained');
 assert.match(message,/prior revision restored|rollback/i);
 assert.doesNotMatch(message,/PRIVATE_JOURNAL_CLEANUP_DETAILS/);
}));

test('FR-029 guarded V1 journal failure never claims successful rollback if the CAS restore is blocked',async()=>fixture(async root=>{
 const oldHash='a'.repeat(64),newHash='b'.repeat(64);
 let calls=0,message='';
 try{
  await executeDurableGuardedManagedApply({
   dataRoot:root,approvalId:randomUUID(),scriptId:'guarded-blocked',
   previousHash:oldHash,preflight:()=>true,
   write:async()=>({hash:newHash}),
   restore:async()=>{calls++;throw new Error('PRIVATE_EXTERNAL_EDITOR_CONFLICT');},
   onRegisterCancel:()=>()=>{throw new Error('PRIVATE_JOURNAL_CLEANUP_DETAILS');},
  });
 }catch(error){message=String((error as Error).message);}
 assert.equal(calls,1);
 assert.match(message,/rollback blocked|manual rollback/i);
 assert.doesNotMatch(message,/PRIVATE_EXTERNAL_EDITOR_CONFLICT|PRIVATE_JOURNAL_CLEANUP_DETAILS/);
}));

test('FR-029 guarded V1 revoked before durable write does not restore or write',async()=>fixture(async root=>{
 let writes=0,rollbacks=0;
 await assert.rejects(executeDurableGuardedManagedApply({
  dataRoot:root,approvalId:randomUUID(),scriptId:'guarded-denied',
  previousHash:'a'.repeat(64),preflight:()=>false,
  write:async()=>{writes++;return {hash:'b'.repeat(64)};},
  restore:async()=>{rollbacks++;return {hash:'a'.repeat(64),activePath:'never'};},
 }),/repair|blocked|approval/i);
 assert.equal(writes,0);assert.equal(rollbacks,0);
}));

test('FR-029 guarded single-script handler uses durable V1 apply wrapper with trusted rollback',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:apply-repair-guarded'");
 const end=main.indexOf("ipcMain.handle('",start+12);
 assert.ok(start>=0&&end>start);
 const handler=main.slice(start,end);
 assert.match(handler,/executeDurableGuardedManagedApply\(\{/);
 assert.match(handler,/dataRoot,approvalId:proposalId,scriptId:trusted\.scriptId/);
 assert.match(handler,/previousHash:trusted\.previousHash/);
 assert.match(handler,/preflight:/);
 assert.match(handler,/write:\s*\(\)=>repairs\.apply\(\{proposalId:proposalId,approved:true\}\)/);
 assert.match(handler,/restore:\s*expectedCurrentHash=>repairs\.restore\(/);
 assert.match(handler,/expectedCurrentHash/);
});

test('FR-029 guarded writer rejecting AFTER activating managed bytes is explicitly uncertain, never a pre-write block',async()=>fixture(async root=>{
 const path=join(root,'managed.user.js'),old='reviewed managed predecessor',next='new managed bytes before write error';
 await writeFile(path,old);
 let attempted=0,restores=0,message='';
 try{
  await executeDurableGuardedManagedApply({
   dataRoot:root,approvalId:randomUUID(),scriptId:'guarded-uncertain',
   previousHash:digest(old),preflight:()=>true,
   write:async()=>{attempted++;await writeFile(path,next);throw Error('PRIVATE_SOURCE_AND_DISK_FAILURE');},
   restore:async()=>{restores++;return {hash:digest(old),activePath:path};},
  });
 }catch(error){message=(error as Error).message;}
 assert.equal(attempted,1);
 assert.equal(await readFile(path,'utf8'),next,'an attempted activation is not provably rolled back');
 assert.equal(restores,0,'without an activation SHA no CAS restore is safe');
 assert.match(message,/uncertain|manual review/i);
 assert.doesNotMatch(message,/blocked; fresh review|PRIVATE_SOURCE_AND_DISK_FAILURE/i,
  'a post-activation throw must not be mislabeled as an unwritten task');
}));

test('FR-029 malformed post-write activation receipt is uncertain, while denied preflight is still blocked',async()=>fixture(async root=>{
 let writes=0,restores=0;
 const run=(allowed:boolean)=>executeDurableGuardedManagedApply({
  dataRoot:root,approvalId:randomUUID(),scriptId:'guarded-no-receipt',
  previousHash:'a'.repeat(64),preflight:()=>allowed,
  write:async()=>{writes++;return {hash:'PRIVATE_INVALID_HASH'};},
  restore:async()=>{restores++;return {hash:'a'.repeat(64),activePath:'unused'};},
 });
 await assert.rejects(run(true),/uncertain|manual review/i);
 assert.equal(writes,1);assert.equal(restores,0);
 await assert.rejects(run(false),/blocked|fresh review/i);
 assert.equal(writes,1);assert.equal(restores,0);
}));
