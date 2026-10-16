import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm,symlink,mkdir,rmdir,lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {savePreferredChromePath,loadPreferredChromePath} from '../src/preferred-chrome.ts';

async function fixture(action:(root:string,exe:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-browser-choice-'));
 const exe=join(root,'Portable Chrome 155.exe');
 await writeFile(exe,'fake binary for path validation');
 try{await action(root,exe)}finally{await rm(root,{recursive:true,force:true});}
}
test('saved portable Chrome selection survives a new settings read',async()=>fixture(async(root,exe)=>{
 await savePreferredChromePath({dataRoot:root,executablePath:exe});
 assert.equal(await loadPreferredChromePath({dataRoot:root}),exe);
 const state=JSON.parse(await readFile(join(root,'preferred-chrome.json'),'utf8'));
 assert.deepEqual(state,{schemaVersion:1,executablePath:exe});
}));
test('invalid or stale previously selected Chrome falls back to no selection and is never executed',async()=>fixture(async(root,exe)=>{
 await savePreferredChromePath({dataRoot:root,executablePath:exe});
 await rm(exe);
 assert.equal(await loadPreferredChromePath({dataRoot:root}),null);
 await writeFile(join(root,'preferred-chrome.json'),'{incomplete');
 assert.equal(await loadPreferredChromePath({dataRoot:root}),null);
}));
test('saved selection does not follow symlink executable or settings file',async t=>fixture(async(root,exe)=>{
 const shortcut=join(root,'redirect.exe');
 try{await symlink(exe,shortcut);}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('Symlink unavailable');return;}throw error;}
 await assert.rejects(savePreferredChromePath({dataRoot:root,executablePath:shortcut}),/symlink|regular/i);
 const config=join(root,'preferred-chrome.json'),outside=join(root,'outside.json');
 await writeFile(outside,'outside');
 await symlink(outside,config);
 await assert.rejects(savePreferredChromePath({dataRoot:root,executablePath:exe}),/symlink|unsafe/i);
 assert.equal(await loadPreferredChromePath({dataRoot:root}),null,'compromised preference must not prevent the desktop app starting');
 assert.equal(await readFile(outside,'utf8'),'outside');
}));
test('rejects a non-absolute or non-EXE Chrome choice',async()=>fixture(async(root,exe)=>{
 await assert.rejects(savePreferredChromePath({dataRoot:root,executablePath:'relative/chrome.exe'}),/absolute/i);
 await assert.rejects(savePreferredChromePath({dataRoot:root,executablePath:exe+'.txt'}),/EXE|executable/i);
}));

test('saved Chrome preference uses bounded identity-pinned reads on the settings file',async()=>fixture(async(root,exe)=>{
 // A config file can change between lstat() and readFile(). Reading it by
 // pathname with no byte cap would bypass the 4096-byte validation race.
 const implementation=await readFile(new URL('../src/preferred-chrome.ts',import.meta.url),'utf8');
 assert.match(implementation,/readPinnedRegularFile\(config/,
  'The optional saved path must be read from a verified bounded file descriptor');
 assert.doesNotMatch(implementation,/await readFile\(config/,
  'Do not reopen an already checked settings pathname for an unbounded read');
 await savePreferredChromePath({dataRoot:root,executablePath:exe});
 assert.equal(await loadPreferredChromePath({dataRoot:root}),exe);
 await writeFile(join(root,'preferred-chrome.json'),' '.repeat(4097));
 assert.equal(await loadPreferredChromePath({dataRoot:root}),null);
}));


test('Chrome choice writes fail closed while another process holds the preference lease',async()=>fixture(async(root,exe)=>{
 const second=join(root,'Alternate Chrome.exe');
 await writeFile(second,'alternate fake browser');
 await savePreferredChromePath({dataRoot:root,executablePath:exe});
 const config=join(root,'preferred-chrome.json');
 const before=await readFile(config,'utf8');
 const lock=join(root,'preferred-chrome.json.write-lock');
 await mkdir(lock);
 try{
  await assert.rejects(
   savePreferredChromePath({dataRoot:root,executablePath:second}),
   /lock|writer|process/i,
   'a second writer must not bypass an existing cross-process preference lock');
  assert.equal(await readFile(config,'utf8'),before,
   'a rejected concurrent writer must not replace an approved browser choice');
  assert.deepEqual((await readdir(lock)),[],
   'a rejected writer must leave the existing owner lock untouched');
 }finally{await rmdir(lock);}
 await savePreferredChromePath({dataRoot:root,executablePath:second});
 assert.equal(await loadPreferredChromePath({dataRoot:root}),second);
}));

test('Chrome choice releases its writer lease after successful and rejected saves',async()=>fixture(async(root,exe)=>{
 const lock=join(root,'preferred-chrome.json.write-lock');
 await savePreferredChromePath({dataRoot:root,executablePath:exe});
 await assert.rejects(lstat(lock),{code:'ENOENT'});
 const corrupt=join(root,'preferred-chrome.json');
 await writeFile(corrupt,'A'.repeat(4097));
 await assert.rejects(
  savePreferredChromePath({dataRoot:root,executablePath:exe}),/safe length/i);
 await assert.rejects(lstat(lock),{code:'ENOENT'},
  'failed write must not strand a permanent lock');
}));
