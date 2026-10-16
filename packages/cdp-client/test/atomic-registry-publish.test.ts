import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {publishRegistrySettingsFile} from '../src/atomic-registry-publish.ts';

async function inTempDir(run:(root:string)=>Promise<void>):Promise<void>{
 const root=await mkdtemp(join(tmpdir(),'usshm-atomic-registry-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06: an initially absent settings file cannot overwrite a competing first writer',async()=>inTempDir(async root=>{
 const target=join(root,'settings.json'),temp=join(root,'candidate.tmp');
 await writeFile(temp,'candidate',{flag:'wx'});
 // Represents a second process publishing after our earlier ENOENT check.
 const winner='{"schemaVersion":1,"owner":"independent-writer"}\n';
 await writeFile(target,winner,{flag:'wx'});
 await assert.rejects(publishRegistrySettingsFile(temp,target,false),{code:'EEXIST'});
 assert.equal(await readFile(target,'utf8'),winner,
  'first-write conflict must preserve the competing settings bytes');
 assert.equal(await readFile(temp,'utf8'),'candidate',
  'failed publish leaves only the caller-owned temporary file for cleanup');
}));

test('RG-06: first publication succeeds atomically without a destination replacement',async()=>inTempDir(async root=>{
 const target=join(root,'settings.json'),temp=join(root,'candidate.tmp');
 await writeFile(temp,'first-version',{flag:'wx'});
 await publishRegistrySettingsFile(temp,target,false);
 await unlink(temp); // Existing callers remove only their own staged path.
 assert.equal(await readFile(target,'utf8'),'first-version');
}));

test('RG-06: an existing validated settings file retains the normal update path',async()=>inTempDir(async root=>{
 const target=join(root,'settings.json'),temp=join(root,'candidate.tmp');
 await writeFile(target,'previous',{flag:'wx'});
 await writeFile(temp,'updated',{flag:'wx'});
 await publishRegistrySettingsFile(temp,target,true);
 assert.equal(await readFile(target,'utf8'),'updated');
 await assert.rejects(readFile(temp,'utf8'),{code:'ENOENT'});
}));

test('FR-001/FR-002 preferences and browser profiles both use the no-replace publisher',async()=>{
 const preference=await readFile(new URL('../src/preferred-chrome.ts',import.meta.url),'utf8');
 const profiles=await readFile(new URL('../src/browser-profiles.ts',import.meta.url),'utf8');
 assert.match(preference,/publishRegistrySettingsFile\(temp,config,previouslyPresent\)/);
 assert.match(profiles,/publishRegistrySettingsFile\(temp,target,previouslyPresent\)/);
});
