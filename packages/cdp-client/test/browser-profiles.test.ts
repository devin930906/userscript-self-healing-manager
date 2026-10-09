import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,symlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
 listBrowserProfiles,createBrowserProfile,renameBrowserProfile,
 setDefaultBrowserProfile,removeBrowserProfile,resolveBrowserProfileForLaunch,
} from '../src/browser-profiles.ts';

async function fixture(run:(root:string,first:string,second:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-browser-profiles-'));
 const first=join(root,'Chrome Portable One.exe'),second=join(root,'Chrome Two.exe');
 await writeFile(first,'fixture exe 1');
 await writeFile(second,'fixture exe 2');
 try{await run(root,first,second)}finally{await rm(root,{recursive:true,force:true})}
}

test('multiple Chrome profiles retain independent names, exe paths and isolated app-owned data directories',async()=>fixture(async(root,first,second)=>{
 const a=await createBrowserProfile({dataRoot:root,name:'工作',executablePath:first});
 const b=await createBrowserProfile({dataRoot:root,name:'测试',executablePath:second});
 assert.notEqual(a.id,b.id);
 assert.equal(a.isDefault,true);
 assert.equal(b.isDefault,false);
 assert.equal((await listBrowserProfiles({dataRoot:root})).length,2);
 const defaulted=await setDefaultBrowserProfile({dataRoot:root,profileId:b.id});
 assert.equal(defaulted.isDefault,true);
 const profiles=await listBrowserProfiles({dataRoot:root});
 assert.deepEqual(profiles.map(x=>x.isDefault),[false,true]);
 assert.deepEqual(profiles.map(x=>x.executablePath),[first,second]);
 const resolved=await resolveBrowserProfileForLaunch({dataRoot:root,profileId:b.id});
 assert.equal(resolved.executablePath,second);
 assert.equal(resolved.isolatedProfileDir,join(root,'Chrome-Profiles',b.id));
 assert.notEqual(resolved.isolatedProfileDir,root);
 const persisted=JSON.parse(await readFile(join(root,'browser-profiles.json'),'utf8'));
 assert.equal(persisted.schemaVersion,1);
 assert.equal(persisted.profiles.length,2);
 assert.equal(persisted.defaultId,b.id);
}));

test('rename and deletion update only profile metadata without deleting profile data or browser',async()=>fixture(async(root,first)=>{
 const a=await createBrowserProfile({dataRoot:root,name:'测试',executablePath:first});
 const directory=join(root,'Chrome-Profiles',a.id);
 const {mkdir}=await import('node:fs/promises');
 await mkdir(directory,{recursive:true});
 const keep=join(directory,'important-bookmark');
 await writeFile(keep,'never remove user profile bytes');
 assert.equal((await renameBrowserProfile({dataRoot:root,profileId:a.id,name:'独立工作'})).name,'独立工作');
 await removeBrowserProfile({dataRoot:root,profileId:a.id,approved:true});
 assert.deepEqual(await listBrowserProfiles({dataRoot:root}),[]);
 assert.equal(await readFile(keep,'utf8'),'never remove user profile bytes');
 assert.equal(await readFile(first,'utf8'),'fixture exe 1');
 await assert.rejects(resolveBrowserProfileForLaunch({dataRoot:root,profileId:a.id}),/missing|unknown|profile|found/i);
}));

test('profile mutation requires consent, rejects spoofed identifiers, unsafe names and reusing a deleted record',async()=>fixture(async(root,first)=>{
 const a=await createBrowserProfile({dataRoot:root,name:'safe',executablePath:first});
 await assert.rejects(removeBrowserProfile({dataRoot:root,profileId:a.id,approved:false}),/approval|consent/i);
 await assert.rejects(renameBrowserProfile({dataRoot:root,profileId:'../outside',name:'bad'}),/id|profile|invalid/i);
 await assert.rejects(renameBrowserProfile({dataRoot:root,profileId:a.id,name:'bad\nnewline'}),/name|invalid/i);
 await assert.rejects(createBrowserProfile({dataRoot:root,name:'',executablePath:first}),/name|invalid/i);
 await assert.rejects(createBrowserProfile({dataRoot:root,name:'malicious',executablePath:'relative.exe'}),/absolute/i);
 assert.equal((await listBrowserProfiles({dataRoot:root})).length,1);
}));

test('unsafe executable paths and persisted state never launch or follow file symlinks',async(t)=>fixture(async(root,first)=>{
 const a=await createBrowserProfile({dataRoot:root,name:'Valid',executablePath:first});
 await rm(first);
 await assert.rejects(resolveBrowserProfileForLaunch({dataRoot:root,profileId:a.id}),/unavailable|missing|executable|unsafe/i);
 const link=join(root,'shortcut.exe');
 await writeFile(first,'valid again');
 try{await symlink(first,link);}catch(e){
  if(['EPERM','EACCES','ENOTSUP'].includes((e as NodeJS.ErrnoException).code??'')){t.skip('symlink not available');return;}
  throw e;
 }
 await assert.rejects(createBrowserProfile({dataRoot:root,name:'shortcut',executablePath:link}),/symlink|unsafe|regular/i);
 const state=join(root,'browser-profiles.json'),secret=join(root,'other.json');
 await writeFile(secret,'private');
 await rm(state);
 await symlink(secret,state);
 assert.deepEqual(await listBrowserProfiles({dataRoot:root}),[]);
 await assert.rejects(createBrowserProfile({dataRoot:root,name:'should not overwrite symlink',executablePath:first}),/unsafe|symlink|regular/i);
 assert.equal(await readFile(secret,'utf8'),'private');
}));

test('corrupt, oversized or malformed profile registry fails closed instead of selecting an arbitrary browser',async()=>fixture(async(root,first)=>{
 const a=await createBrowserProfile({dataRoot:root,name:'Normal',executablePath:first});
 const state=join(root,'browser-profiles.json');
 for(const content of ['{invalid',' '.repeat(32769),JSON.stringify({schemaVersion:1,profiles:[{...a,id:'../attack'}],defaultId:'../attack'})]){
  await writeFile(state,content);
  assert.deepEqual(await listBrowserProfiles({dataRoot:root}),[]);
  await assert.rejects(resolveBrowserProfileForLaunch({dataRoot:root,profileId:a.id}),/invalid|missing|unavailable|profile/i);
  await assert.rejects(createBrowserProfile({dataRoot:root,name:'new',executablePath:first}),/corrupt|invalid|unsafe|refus/i);
 }
}));
