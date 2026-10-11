import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {guardAppliedManagedRevision} from '../../packages/repair-workflow/src/guarded-v1.ts';
import {guardAppliedManagedBatchRevision} from '../../packages/repair-workflow/src/guarded-batch-v1.ts';
import {inspectManagedIntegrity} from '../../packages/repair-workflow/src/managed-health.ts';
import {activateManagedRevision} from '../../packages/repair-workflow/src/history.ts';

const scriptId='safe-fixture';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const prior='// approved and archived original userscript';
const patch='// approved and archived patched userscript';
const changed='// externally modified private user content';
const previousHash=hash(prior),appliedHash=hash(patch);
const goodSingle={
 status:'passed',evidenceLevel:'V1',expectation:'unique',attempts:2,matchCount:1,
 V2:'blocked',V3:'not-configured',V4:'not-configured',
 functionalVerified:false,managerVerified:false,
};
const goodBatch=(index:number)=>({...goodSingle,caseId:'BATCH:'+scriptId+':IDX_'+index});

async function fixture(fn:(args:{
 root:string;folder:string;current:string;
 confirmActiveHash:()=>Promise<string|null>;
 restore:(hash:string)=>Promise<{hash:string;activePath:string}>;
})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-guard-current-'));
 const folder=join(root,'managed',scriptId);
 const current=join(folder,'current.user.js');
 try{
  await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'original-'+previousHash+'.user.js'),prior);
  await writeFile(join(folder,'revision-'+appliedHash+'.user.js'),patch);
  await writeFile(current,patch);
  const confirmActiveHash=async()=>{
   const report=await inspectManagedIntegrity({managedRoot:root,scriptId});
   return report.status==='healthy'?report.activeHash:null;
  };
  const restore=(hashValue:string)=>activateManagedRevision({
   managedRoot:root,scriptId,hash:hashValue,approved:true,
   expectedCurrentHash:appliedHash,
  });
  await fn({root,folder,current,confirmActiveHash,restore});
 }finally{await rm(root,{recursive:true,force:true});}
}

test('actual archived current retained only when post-CDP disk integrity matches the activated revision',async()=>fixture(async({root,current,confirmActiveHash,restore})=>{
 const result=await guardAppliedManagedRevision({
  approved:true,scriptId,appliedHash,previousHash,confirmActiveHash,
  verify:async()=>goodSingle,restore,
 });
 assert.equal(result.status,'retained-v1');
 assert.equal(result.activeHash,appliedHash);
 assert.equal(await readFile(current,'utf8'),patch);
 assert.equal((await inspectManagedIntegrity({managedRoot:root,scriptId})).status,'healthy');
 assert.equal(result.V3,'not-configured');
}));

test('external edit occurring during single V1 verification blocks false retention and refuses destructive CAS rollback',async()=>fixture(async({current,confirmActiveHash,restore})=>{
 const result=await guardAppliedManagedRevision({
  approved:true,scriptId,appliedHash,previousHash,confirmActiveHash,
  verify:async()=>{
   await writeFile(current,changed);
   return goodSingle;
  },restore,
 });
 assert.equal(result.status,'rollback-blocked');
 assert.equal(result.activeHash,null);
 assert.equal(result.functionalVerified,false);
 assert.equal(await readFile(current,'utf8'),changed,'an external edit must be preserved');
}));

test('external edit on the final selector of an otherwise passing batch does not get retained or overwritten',async()=>fixture(async({current,confirmActiveHash,restore})=>{
 const result=await guardAppliedManagedBatchRevision({
  approved:true,scriptId,appliedHash,previousHash,
  selectorIndexes:[1,3],confirmActiveHash,restore,
  verify:async(index:number)=>{
   if(index===3)await writeFile(current,changed);
   return goodBatch(index);
  },
 });
 assert.equal(result.status,'rollback-blocked');
 assert.deepEqual(result.verifiedIndexes,[1,3]);
 assert.equal(result.activeHash,null);
 assert.equal(await readFile(current,'utf8'),changed);
 assert.equal(result.V4,'not-configured');
}));

test('an orphan managed write lease cannot be ignored when every DOM check passes',async()=>fixture(async({current,confirmActiveHash,restore})=>{
 const lock=current+'.write-lock';
 await mkdir(lock);
 const result=await guardAppliedManagedRevision({
  approved:true,scriptId,appliedHash,previousHash,confirmActiveHash,
  verify:async()=>goodSingle,restore,
 });
 assert.equal(result.status,'rollback-blocked','do not report verified retention while another writer owns a lock');
 assert.equal(result.activeHash,null);
 assert.equal(await readFile(current,'utf8'),patch);
}));
