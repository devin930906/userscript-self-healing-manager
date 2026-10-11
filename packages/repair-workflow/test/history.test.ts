import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {listManagedRevisions,activateManagedRevision} from '../src/history.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function withRevisions(fn:(root:string,source:string,revision:string,originalHash:string,revisionHash:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-history-'));
 const folder=join(root,'managed','my-script');await mkdir(folder,{recursive:true});
 const source='const alpha=document.querySelector("#old");\n';
 const revision='const alpha=document.querySelector("#new");\n';
 const originalHash=hash(source),revisionHash=hash(revision);
 await writeFile(join(folder,'original-'+originalHash+'.user.js'),source);
 await writeFile(join(folder,'revision-'+revisionHash+'.user.js'),revision);
 try{await fn(root,source,revision,originalHash,revisionHash)}finally{await rm(root,{recursive:true,force:true})}
}
test('lists SHA-verified immutable originals and revision entries',async()=>withRevisions(async(root,_source,_rev,originalHash,revisionHash)=>{
 const result=await listManagedRevisions({managedRoot:root,scriptId:'my-script'});
 assert.equal(result.length,2);
 assert.deepEqual(new Set(result.map(x=>x.hash)),new Set([originalHash,revisionHash]));
 assert.deepEqual(new Set(result.map(x=>x.kind)),new Set(['original','revision']));
 assert.ok(result.every(x=>x.verified));
}));
test('explicit restore changes current managed copy atomically; keeps immutable revision',async()=>withRevisions(async(root,source,revision,originalHash,revisionHash)=>{
 const a=await activateManagedRevision({managedRoot:root,scriptId:'my-script',hash:revisionHash,approved:true});
 assert.equal(await readFile(a.activePath,'utf8'),revision);
 const b=await activateManagedRevision({managedRoot:root,scriptId:'my-script',hash:originalHash,approved:true});
 assert.equal(await readFile(b.activePath,'utf8'),source);
 assert.equal(await readFile(join(root,'managed','my-script','revision-'+revisionHash+'.user.js'),'utf8'),revision);
}));
test('requires approval and guards scriptId, hash, missing revisions',async()=>withRevisions(async(root,_source,_revision,_oldHash,hash)=>{
 await assert.rejects(activateManagedRevision({managedRoot:root,scriptId:'my-script',hash,approved:false}),/approval/i);
 await assert.rejects(activateManagedRevision({managedRoot:root,scriptId:'../other',hash,approved:true}),/unsafe/i);
 await assert.rejects(activateManagedRevision({managedRoot:root,scriptId:'my-script',hash:'../escape',approved:true}),/hash/i);
 await assert.rejects(activateManagedRevision({managedRoot:root,scriptId:'my-script',hash:'a'.repeat(64),approved:true}),/not found/i);
}));
test('rejects tampered and symlinked archived snapshots',async()=>withRevisions(async(root,source,_revision,originalHash,revisionHash)=>{
 const folder=join(root,'managed','my-script');
 await writeFile(join(folder,'revision-'+revisionHash+'.user.js'),'tampered');
 await assert.rejects(activateManagedRevision({managedRoot:root,scriptId:'my-script',hash:revisionHash,approved:true}),/hash mismatch/i);
 await assert.rejects(listManagedRevisions({managedRoot:root,scriptId:'my-script'}),/hash mismatch/i);
 await rm(join(folder,'revision-'+revisionHash+'.user.js'));
 await symlink(join(folder,'original-'+originalHash+'.user.js'),join(folder,'revision-'+revisionHash+'.user.js'));
 await assert.rejects(activateManagedRevision({managedRoot:root,scriptId:'my-script',hash:revisionHash,approved:true}),/symlink/i);
 assert.equal(await readFile(join(folder,'original-'+originalHash+'.user.js'),'utf8'),source);
}));

test('rollback refuses to overwrite a managed current file with unmanaged external edits',async()=>withRevisions(async(root,_source,_revision,originalHash,revisionHash)=>{
 const folder=join(root,'managed','my-script');
 const active=await activateManagedRevision({managedRoot:root,scriptId:'my-script',hash:revisionHash,approved:true});
 await writeFile(active.activePath,'external content that is not an archived revision');
 await assert.rejects(activateManagedRevision({managedRoot:root,scriptId:'my-script',hash:originalHash,approved:true}),/unmanaged|modified|external/i);
 assert.equal(await readFile(active.activePath,'utf8'),'external content that is not an archived revision');
}));
test('rollback rejects symlinked managed current file and leaves outside target unchanged',async()=>withRevisions(async(root,_source,_revision,originalHash)=>{
 const folder=join(root,'managed','my-script'),external=join(root,'keep.txt');
 await writeFile(external,'outside safety marker');
 await symlink(external,join(folder,'current.user.js'));
 await assert.rejects(activateManagedRevision({managedRoot:root,scriptId:'my-script',hash:originalHash,approved:true}),/symlink/i);
 assert.equal(await readFile(external,'utf8'),'outside safety marker');
}));
