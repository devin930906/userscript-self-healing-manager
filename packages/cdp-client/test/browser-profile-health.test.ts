import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBrowserProfile,inspectBrowserProfileRegistry} from '../src/browser-profiles.ts';
test('browser profile registry health distinguishes no profiles, persisted profiles and orphan writer lock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-profiles-health-'));
 try{
  assert.deepEqual(await inspectBrowserProfileRegistry({dataRoot:root}),{status:'empty',count:0});
  const chrome=join(root,'Chrome.exe');await writeFile(chrome,'fixture');
  await createBrowserProfile({dataRoot:root,name:'Default',executablePath:chrome});
  assert.deepEqual(await inspectBrowserProfileRegistry({dataRoot:root}),{status:'ready',count:1});
  await mkdir(join(root,'browser-profiles.json.write-lock'));
  assert.deepEqual(await inspectBrowserProfileRegistry({dataRoot:root}),{status:'write-locked',count:null});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('corrupt profile registry is never reported as an empty healthy collection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-profiles-health-'));
 try{
  await writeFile(join(root,'browser-profiles.json'),'{corrupt');
  assert.deepEqual(await inspectBrowserProfileRegistry({dataRoot:root}),{status:'invalid',count:null});
 }finally{await rm(root,{recursive:true,force:true});}
});
