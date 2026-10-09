import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,readFile,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectManagedIntegrity} from '../src/managed-health.ts';

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
async function withStore(run:(root:string,folder:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-managed-health-'));
 const folder=join(root,'managed','script-1');
 try{await run(root,folder)}finally{await rm(root,{recursive:true,force:true})}
}
async function archive(folder:string,text:string,kind:'original'|'revision'='original'){
 await mkdir(folder,{recursive:true});
 const sha=hash(text);
 await writeFile(join(folder,kind+'-'+sha+'.user.js'),text);
 return sha;
}
const probe=(root:string)=>inspectManagedIntegrity({managedRoot:root,scriptId:'script-1'});

test('read-only integrity check reports empty archive without creating any files',async()=>withStore(async(root,folder)=>{
 const result=await probe(root);
 assert.deepEqual(result,{status:'empty',archiveCount:0,activeHash:null});
 await assert.rejects(readFile(join(folder,'current.user.js')),{code:'ENOENT'});
}));

test('read-only integrity check distinguishes valid active, verified archives and missing activation',async()=>withStore(async(root,folder)=>{
 const sha=await archive(folder,'original script');
 let report=await probe(root);
 assert.deepEqual(report,{status:'missing-current',archiveCount:1,activeHash:null});
 await writeFile(join(folder,'current.user.js'),'original script');
 report=await probe(root);
 assert.deepEqual(report,{status:'healthy',archiveCount:1,activeHash:sha});
}));

test('externally edited managed current is not misrepresented as verified',async()=>withStore(async(root,folder)=>{
 await archive(folder,'verified script');
 await writeFile(join(folder,'current.user.js'),'externally changed');
 const report=await probe(root);
 assert.equal(report.status,'unarchived-current');
 assert.equal(report.activeHash,null,'never expose fingerprint of externally edited unknown script');
 assert.equal(report.archiveCount,1);
}));

test('corrupted immutable archive is reported as damaged instead of silently skipped',async()=>withStore(async(root,folder)=>{
 const sha=await archive(folder,'verified script');
 await writeFile(join(folder,'original-'+sha+'.user.js'),'tampered');
 const report=await probe(root);
 assert.equal(report.status,'damaged-archive');
 assert.equal(report.activeHash,null);
}));

test('writer lock has priority over incomplete current and is never deleted by health inspection',async()=>withStore(async(root,folder)=>{
 await archive(folder,'verified script');
 const lock=join(folder,'current.user.js.write-lock');
 await mkdir(lock);
 const report=await probe(root);
 assert.equal(report.status,'write-locked');
 const stillLocked=await readFile(join(lock,'sentinel'), 'utf8').catch(e=>e.code);
 assert.equal(stillLocked,'ENOENT');
 const again=await probe(root);
 assert.equal(again.status,'write-locked');
}));

test('symlink in managed folder or active file is unsafe and its target is never read',async t=>withStore(async(root,folder)=>{
 await mkdir(join(root,'managed'),{recursive:true});
 const external=join(root,'private.user.js');await writeFile(external,'secret data');
 try{await symlink(external,folder);}catch(error){
  if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('symlink unavailable');return;}
  throw error;
 }
 let report=await probe(root);assert.equal(report.status,'unsafe');
 assert.equal(JSON.stringify(report).includes('secret'),false);
 await rm(folder);
 await archive(folder,'verified script');
 await symlink(external,join(folder,'current.user.js'));
 report=await probe(root);assert.equal(report.status,'unsafe');
 assert.equal(JSON.stringify(report).includes('secret'),false);
}));

test('health read rejects unsafe script IDs before any read',async()=>withStore(async(root)=>{
 await assert.rejects(inspectManagedIntegrity({managedRoot:root,scriptId:'../../other'}),/scriptId|unsafe|invalid/i);
}));
