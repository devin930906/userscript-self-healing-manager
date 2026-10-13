import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {savePreferredChromePath,loadPreferredChromePath} from '../src/preferred-chrome.ts';
import {createBrowserProfile,resolveBrowserProfileForLaunch,listBrowserProfiles} from '../src/browser-profiles.ts';

/** Only temporary directories and fake EXE bytes. This suite NEVER launches Chrome. */
async function fixture(t:TestContext,run:(root:string,exe:string,physical:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-chrome-exe-ancestor-'));
 try{
  const physical=join(root,'physical-browser');
  await mkdir(physical);
  const exe=join(physical,'Chrome.exe');
  await writeFile(exe,'synthetic Chrome executable placeholder');
  await run(root,exe,physical);
 }finally{await rm(root,{recursive:true,force:true});}
}
async function junction(t:TestContext,physical:string,alias:string):Promise<boolean>{
 try{
  await symlink(physical,alias,process.platform==='win32'?'junction':'dir');
  return true;
 }catch(error){
  if(['EPERM','EACCES','ENOTSUP','EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code??'')){
   t.skip('Directory symlinks/Junctions unavailable on this runner');
   return false;
  }
  throw error;
 }
}

test('RG-04 rejects a selected Chrome EXE underneath a linked directory before persisting any setting',async t=>
 fixture(t,async(root,exe,physical)=>{
  const alias=join(root,'linked-browser');
  if(!await junction(t,physical,alias))return;
  const aliasedExe=join(alias,'Chrome.exe');
  await assert.rejects(
   savePreferredChromePath({dataRoot:root,executablePath:aliasedExe}),
   /unsafe|symlink|junction|regular|Chrome executable/i);
  await assert.rejects(
   createBrowserProfile({dataRoot:root,name:'Unsafe',executablePath:aliasedExe}),
   /unsafe|symlink|junction|directory|Chrome executable/i);
  await assert.rejects(access(join(root,'preferred-chrome.json')),{code:'ENOENT'});
  await assert.rejects(access(join(root,'browser-profiles.json')),{code:'ENOENT'});
  assert.deepEqual(await listBrowserProfiles({dataRoot:root}),[]);
  assert.equal(await readFile(exe,'utf8'),'synthetic Chrome executable placeholder');
 }));

test('RG-04 refuses previously selected Chrome executable after its parent is replaced by a Junction',async t=>
 fixture(t,async(root,exe,physical)=>{
  await savePreferredChromePath({dataRoot:root,executablePath:exe});
  const first=await createBrowserProfile({dataRoot:root,name:'Saved',executablePath:exe});
  assert.equal(await loadPreferredChromePath({dataRoot:root}),exe);
  const relocated=join(root,'relocated-browser');
  await rename(physical,relocated);
  if(!await junction(t,relocated,physical))return;
  assert.equal(await loadPreferredChromePath({dataRoot:root}),null,
   'an untrusted saved executable path must not be reselected on startup');
  await assert.rejects(
   resolveBrowserProfileForLaunch({dataRoot:root,profileId:first.id}),
   /unsafe|symlink|junction|directory|Chrome executable/i,
   'a persisted registry must not authorize launching through a new directory alias');
  assert.equal((await listBrowserProfiles({dataRoot:root}))[0]?.id,first.id);
  assert.equal(await readFile(join(relocated,'Chrome.exe'),'utf8'),
   'synthetic Chrome executable placeholder');
 }));

test('RG-04 retains an ordinary selected Chrome EXE for saved preference and profile launch',async t=>
 fixture(t,async(root,exe)=>{
  await savePreferredChromePath({dataRoot:root,executablePath:exe});
  const created=await createBrowserProfile({dataRoot:root,name:'Regular',executablePath:exe});
  assert.equal(await loadPreferredChromePath({dataRoot:root}),exe);
  const selected=await resolveBrowserProfileForLaunch({dataRoot:root,profileId:created.id});
  assert.equal(selected.executablePath,exe);
  assert.equal(selected.isolatedProfileDir,join(root,'Chrome-Profiles',created.id));
 }));
