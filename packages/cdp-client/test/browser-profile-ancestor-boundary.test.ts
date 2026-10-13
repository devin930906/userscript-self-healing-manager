import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {mkdtemp,mkdir,writeFile,symlink,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
 createBrowserProfile,listBrowserProfiles,inspectBrowserProfileRegistry,
 resolveBrowserProfileForLaunch,
} from '../src/browser-profiles.ts';

/** Synthetic fixture only: never use an actual user profile or Chrome binary. */
async function aliasedDataRoot(
 t:TestContext,
 kind:'leaf'|'ancestor',
 run:(realData:string,aliasedData:string,chrome:string,profileId:string)=>Promise<void>,
){
 const root=await mkdtemp(join(tmpdir(),'usshm-profile-ancestor-'));
 try{
  const actualParent=join(root,'original');
  const realData=join(actualParent,'Data');
  const chrome=join(root,'Synthetic Chrome.exe');
  await mkdir(realData,{recursive:true});
  await writeFile(chrome,'synthetic executable only');
  const first=await createBrowserProfile({
   dataRoot:realData,name:'Original',executablePath:chrome,
  });
  const aliasedData=kind==='leaf'?join(root,'linked-Data'):join(root,'linked-parent','Data');
  try{
   await symlink(kind==='leaf'?realData:actualParent,
    kind==='leaf'?aliasedData:join(root,'linked-parent'),'junction');
  }catch(error){
   if(['EPERM','EACCES','ENOTSUP','EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Directory symlinks/Junctions unavailable on this runner');
    return;
   }
   throw error;
  }
  await run(realData,aliasedData,chrome,first.id);
 }finally{
  await rm(root,{recursive:true,force:true});
 }
}

for(const kind of ['leaf','ancestor'] as const){
 test('RG-06 profile registry rejects '+kind+' directory alias for reads, health and Chrome launch',async t=>
  aliasedDataRoot(t,kind,async(realData,alias,chrome,profileId)=>{
   assert.deepEqual(await inspectBrowserProfileRegistry({dataRoot:realData}),
    {status:'ready',count:1});
   assert.deepEqual(await inspectBrowserProfileRegistry({dataRoot:alias}),
    {status:'invalid',count:null},'aliased registry must never look healthy');
   assert.deepEqual(await listBrowserProfiles({dataRoot:alias}),[],
    'do not disclose profile paths via a redirected Data root');
   await assert.rejects(
    resolveBrowserProfileForLaunch({dataRoot:alias,profileId}),
    /unsafe|symlink|junction|ancestor|directory/i,
   );
   assert.equal((await listBrowserProfiles({dataRoot:realData}))[0]?.executablePath,chrome);
  }),
 );
 test('RG-06 profile registry rejects '+kind+' directory alias before acquiring write lease',async t=>
  aliasedDataRoot(t,kind,async(realData,alias,chrome)=>{
   await assert.rejects(
    createBrowserProfile({dataRoot:alias,name:'Redirected',executablePath:chrome}),
    /unsafe|symlink|junction|ancestor|directory/i,
    'a linked Data root cannot redirect registry updates outside the intended tree',
   );
   assert.equal((await listBrowserProfiles({dataRoot:realData})).length,1,
    'original profile registry must remain unchanged');
   await assert.rejects(access(join(realData,'browser-profiles.json.write-lock')),
    {code:'ENOENT'},'an unsafe root must not acquire a write lease');
  }),
 );
}
