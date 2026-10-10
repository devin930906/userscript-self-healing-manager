import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,readFile,writeFile,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {enumerateScripts,importPaths} from '../src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository,type ScriptRecord} from '../../persistence/src/index.ts';

test('a selected source underneath a symlinked ancestor never crosses into the linked directory',async t=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-registry-parent-link-'));
 const db=openDatabase(':memory:');migrateDatabase(db);
 try{
  const outside=join(root,'outside'),shortcut=join(root,'shortcut');
  await mkdir(outside);
  const original=join(outside,'same.user.js');
  const bytes=Buffer.from('// ==UserScript==\n// @name Protected\n// ==/UserScript==\nconst a = 1;\n');
  await writeFile(original,bytes);
  try {await symlink(outside,shortcut,process.platform==='win32'?'junction':'dir');}
  catch(e){
   if(['EPERM','EACCES','ENOTSUP'].includes((e as NodeJS.ErrnoException).code??'')){
    t.skip('Directory links unavailable on this runner');return;
   }
   throw e;
  }
  const selected=join(shortcut,'same.user.js');
  const results=await importPaths({paths:[selected],recursive:false,repository:createScriptRepository(db)});
  assert.deepEqual(results.map(x=>x.status),['symlink-skipped']);
  assert.equal(results[0]?.analysis,undefined);
  const scanned=await enumerateScripts({paths:[selected],recursive:true,followSymlinks:false});
  assert.deepEqual(scanned.map(x=>x.status),['symlink-skipped']);
  assert.deepEqual(createScriptRepository(db).list(),[]);
  assert.deepEqual(await readFile(original),bytes);
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});

test('one repository write failure is reported per-file and later imports continue without touching source files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-registry-write-retry-'));
 const db=openDatabase(':memory:');migrateDatabase(db);
 try{
  const filenames=['one.user.js','failing.user.js','three.user.js'];
  const paths=filenames.map(name=>join(root,name));
  for(const [i,path] of paths.entries())await writeFile(path,`// ==UserScript==\n// @name Test ${i}\n// ==/UserScript==\nconst n = ${i};\n`);
  const before=await Promise.all(paths.map(async path=>({bytes:await readFile(path),mtime:(await stat(path)).mtimeMs})));
  const actual=createScriptRepository(db);
  const failing={
   ...actual,
   upsert(record:ScriptRecord):void{
    if(record.path===paths[1])throw new Error('simulated SQLITE_BUSY (recoverable)');
    actual.upsert(record);
   }
  };
  const results=await importPaths({paths,recursive:false,repository:failing});
  assert.deepEqual(results.map(x=>x.status),['imported','storage-error','imported']);
  assert.equal(results[1]?.scriptId,undefined);
  assert.equal(actual.list().length,2);
  const retry=await importPaths({paths:[paths[1]!],recursive:false,repository:actual});
  assert.equal(retry[0]?.status,'imported');
  assert.equal(actual.list().length,3);
  for(const [i,path] of paths.entries()){
   assert.deepEqual(await readFile(path),before[i]?.bytes);
   assert.equal((await stat(path)).mtimeMs,before[i]?.mtime);
  }
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});

test('Unicode siblings with identical names retain distinct IDs and repeated exact paths reuse their IDs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-registry-identity-'));
 const db=openDatabase(':memory:');migrateDatabase(db);
 try{
  const first=join(root,'中文'),second=join(root,'latin');
  await mkdir(first);await mkdir(second);
  const one=join(first,'script.user.js'),two=join(second,'script.user.js');
  await writeFile(one,'const a=1;');await writeFile(two,'const b=2;');
  const repo=createScriptRepository(db);
  const initial=await importPaths({paths:[one,two],recursive:false,repository:repo});
  assert.equal(initial[0]?.status,'imported');assert.equal(initial[1]?.status,'imported');
  assert.notEqual(initial[0]?.scriptId,initial[1]?.scriptId);
  const repeat=await importPaths({paths:[one,one,two],recursive:false,repository:repo});
  assert.deepEqual(repeat.map(x=>x.status),['imported','duplicate-path','imported']);
  assert.equal(repeat[0]?.scriptId,initial[0]?.scriptId);
  assert.equal(repeat[2]?.scriptId,initial[1]?.scriptId);
  assert.equal(repo.list().length,2);
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
