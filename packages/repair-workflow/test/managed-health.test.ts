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

test('unfinished managed-current staging is diagnosed rather than quietly reported healthy',async()=>withStore(async(root,folder)=>{
 const sha=await archive(folder,'verified revision','revision');
 await writeFile(join(folder,'current.user.js'),'verified revision');
 const stage=join(folder,'.current.user.js.staging-4bcbf331-3448-4b87-bbc2-5aefc4df62c1.tmp');
 await writeFile(stage,'partially staged but not published');
 const report=await probe(root);
 assert.equal(report.status,'staging-leftover');
 assert.equal(report.archiveCount,1);
 assert.equal(report.activeHash,null,'unrecovered staging must not imply safe active state');
 assert.equal(await readFile(stage,'utf8'),'partially staged but not published','read-only inspection must not delete staging');
 assert.equal(await readFile(join(folder,'current.user.js'),'utf8'),'verified revision');
 // Recovery is intentionally external and offline; once orphan is removed,
 // the ordinary immutable hash evidence must still validate successfully.
 await rm(stage);
 assert.deepEqual(await probe(root),{status:'healthy',archiveCount:1,activeHash:sha});
}));

test('unfinished immutable archive staging is visible even when no current was activated',async()=>withStore(async(root,folder)=>{
 await mkdir(folder,{recursive:true});
 const stage=join(folder,'.revision-'+hash('new approved revision')+'.user.js.staging-88888888-1111-4111-8111-121212121212.tmp');
 await writeFile(stage,'only a partial revision exists');
 const report=await probe(root);
 assert.equal(report.status,'staging-leftover');
 assert.equal(report.archiveCount,0);
 assert.equal(report.activeHash,null);
 assert.equal(await readFile(stage,'utf8'),'only a partial revision exists');
}));

test('writer lock and immutable archive corruption take priority over crash staging evidence',async()=>withStore(async(root,folder)=>{
 const sha=await archive(folder,'verified revision','revision');
 const stage=join(folder,'.revision-'+sha+'.user.js.staging-88888888-1111-4111-8111-121212121212.tmp');
 await writeFile(stage,'incomplete');
 const lock=join(folder,'current.user.js.write-lock');
 await mkdir(lock);
 assert.equal((await probe(root)).status,'write-locked');
 await rm(lock,{recursive:true});
 await writeFile(join(folder,'revision-'+sha+'.user.js'),'corrupt archive');
 assert.equal((await probe(root)).status,'damaged-archive');
 assert.equal(await readFile(stage,'utf8'),'incomplete');
}));

test('unarchived external edits take precedence over abandoned stage files',async()=>withStore(async(root,folder)=>{
 const sha=await archive(folder,'trusted revision','revision');
 await writeFile(join(folder,'current.user.js'),'modified by an external editor');
 const stage=join(folder,'.revision-'+sha+'.user.js.staging-88888888-1111-4111-8111-121212121212.tmp');
 await writeFile(stage,'unfinished old stage');
 const report=await probe(root);
 assert.equal(report.status,'unarchived-current');
 assert.equal(report.activeHash,null);
 assert.equal(report.archiveCount,1);
 assert.equal(await readFile(stage,'utf8'),'unfinished old stage');
 assert.equal(await readFile(join(folder,'current.user.js'),'utf8'),'modified by an external editor');
}));

test('unrelated files do not falsely trigger orphan staging diagnostics',async()=>withStore(async(root,folder)=>{
 const sha=await archive(folder,'approved revision','revision');
 await writeFile(join(folder,'current.user.js'),'approved revision');
 await writeFile(join(folder,'.current.user.js.staging-not-a-uuid.tmp'),'unrelated diagnostic');
 assert.deepEqual(await probe(root),{status:'healthy',archiveCount:1,activeHash:sha});
}));
