import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBrowserProfile,listBrowserProfiles,resolveBrowserProfileForLaunch} from '../src/browser-profiles.ts';

/** Fully synthetic directories and executable placeholders. No Chrome is started. */
async function withProfile(t:TestContext,kind:'container'|'profile',run:(
 root:string,profileId:string,physical:string,chrome:string
)=>Promise<void>):Promise<void>{
 const root=await mkdtemp(join(tmpdir(),'usshm-profile-launch-boundary-'));
 try{
  const chrome=join(root,'Synthetic Chrome.exe');
  await writeFile(chrome,'synthetic-placeholder');
  const first=await createBrowserProfile({dataRoot:root,name:'Synthetic',executablePath:chrome});
  const physical=join(root,'physical-outside');
  const container=join(root,'Chrome-Profiles');
  await mkdir(physical);
  await writeFile(join(physical,'keep.txt'),'keep-original');
  if(kind==='profile')await mkdir(container);
  const alias=kind==='container'?container:join(container,first.id);
  try{await symlink(physical,alias,process.platform==='win32'?'junction':'dir');}
  catch(e){
   if(['EPERM','EACCES','ENOTSUP','EOPNOTSUPP'].includes((e as NodeJS.ErrnoException).code??'')){
    t.skip('Directory links unavailable on this CI runner');
    return;
   }
   throw e;
  }
  await run(root,first.id,physical,chrome);
 }finally{await rm(root,{recursive:true,force:true});}
}

for(const kind of ['container','profile'] as const){
 test('RG-04 launch resolver rejects linked '+kind+' Chrome-Profiles directory',async t=>
  withProfile(t,kind,async(root,id,physical,chrome)=>{
   await assert.rejects(
    resolveBrowserProfileForLaunch({dataRoot:root,profileId:id}),
    /unsafe|symlink|junction|profile directory|linked/i,
    'an existing redirected browser data directory must not be returned for launch');
   assert.equal(await readFile(join(physical,'keep.txt'),'utf8'),'keep-original');
   assert.equal(await readFile(chrome,'utf8'),'synthetic-placeholder');
   assert.equal((await listBrowserProfiles({dataRoot:root}))[0]?.id,id,
    'refused launch must not damage stored profile metadata');
  }),
 );
}

test('RG-04 launch resolver rejects file in place of Chrome-Profiles directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-profile-launch-file-'));
 try{
  const chrome=join(root,'Synthetic Chrome.exe');
  await writeFile(chrome,'placeholder');
  const selected=await createBrowserProfile({dataRoot:root,name:'Valid',executablePath:chrome});
  await writeFile(join(root,'Chrome-Profiles'),'not-a-directory');
  await assert.rejects(
   resolveBrowserProfileForLaunch({dataRoot:root,profileId:selected.id}),
   /unsafe|directory|profile/i,
  );
 }finally{await rm(root,{recursive:true,force:true});}
});

test('RG-04 launch resolver preserves an existing regular isolated profile directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-profile-launch-positive-'));
 try{
  const chrome=join(root,'Synthetic Chrome.exe');
  await writeFile(chrome,'placeholder');
  const selected=await createBrowserProfile({dataRoot:root,name:'Valid',executablePath:chrome});
  await mkdir(join(root,'Chrome-Profiles',selected.id),{recursive:true});
  const resolved=await resolveBrowserProfileForLaunch({dataRoot:root,profileId:selected.id});
  assert.deepEqual(resolved,{
   executablePath:chrome,
   isolatedProfileDir:join(root,'Chrome-Profiles',selected.id),
  });
 }finally{await rm(root,{recursive:true,force:true});}
});
