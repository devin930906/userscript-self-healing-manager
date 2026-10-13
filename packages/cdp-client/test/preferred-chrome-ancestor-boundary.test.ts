import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {savePreferredChromePath,loadPreferredChromePath} from '../src/preferred-chrome.ts';

/** All paths and EXE contents are synthetic; never inspect user Chrome profiles. */
async function withLinkedChromePreference(
 t:TestContext,kind:'leaf'|'ancestor',
 fn:(actual:string,alias:string,first:string,second:string)=>Promise<void>,
){
 const root=await mkdtemp(join(tmpdir(),'usshm-preferred-ancestor-'));
 try{
  const parent=join(root,'real');
  const actual=join(parent,'Data');
  const first=join(root,'Synthetic Chrome A.exe');
  const second=join(root,'Synthetic Chrome B.exe');
  await mkdir(actual,{recursive:true});
  await writeFile(first,'synthetic binary A');
  await writeFile(second,'synthetic binary B');
  await savePreferredChromePath({dataRoot:actual,executablePath:first});
  const alias=kind==='leaf'?join(root,'linked-Data'):join(root,'linked-parent','Data');
  try{
   await symlink(kind==='leaf'?actual:parent,
    kind==='leaf'?alias:join(root,'linked-parent'),'junction');
  }catch(error){
   if(['EPERM','EACCES','ENOTSUP','EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Directory link/Junction creation unavailable');
    return;
   }
   throw error;
  }
  await fn(actual,alias,first,second);
 }finally{await rm(root,{recursive:true,force:true});}
}

for(const kind of ['leaf','ancestor'] as const){
 test('RG-06 saved Chrome preference must not load through linked '+kind+' directory',async t=>
  withLinkedChromePreference(t,kind,async(actual,alias,first)=>{
   assert.equal(await loadPreferredChromePath({dataRoot:actual}),first);
   assert.equal(await loadPreferredChromePath({dataRoot:alias}),null,
    'an aliased Data directory must not select an unrelated Chrome path');
  }),
 );
 test('RG-06 saved Chrome preference must not write through linked '+kind+' directory',async t=>
  withLinkedChromePreference(t,kind,async(actual,alias,first,second)=>{
   const path=join(actual,'preferred-chrome.json');
   const original=await readFile(path);
   await assert.rejects(
    savePreferredChromePath({dataRoot:alias,executablePath:second}),
    /unsafe|symlink|junction|directory|ancestor/i,
    'reject a linked Data root before staging or renaming any preference file',
   );
   assert.deepEqual(await readFile(path),original,
    'keep actual existing Chrome choice byte-for-byte intact');
   assert.equal(await loadPreferredChromePath({dataRoot:actual}),first);
  }),
 );
}
