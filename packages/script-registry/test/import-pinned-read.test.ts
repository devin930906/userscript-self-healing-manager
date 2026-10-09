import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile,readFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {importPaths} from '../src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../persistence/src/index.ts';

test('script import reads through the identity-pinned 512 KiB descriptor, never a raw path read',async()=>{
 const code=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
 assert.match(code,/readPinnedRegularFile\(path,\s*\{maxBytes:512\s*\*\s*1024,expected:info\}\)/,
  'Lstat-size verification followed by path-only readFile has a symlink-swap/unbounded-size race');
 assert.doesNotMatch(code,/\bawait\s+readFile\(path\)/);
});
test('file import preserves exact SHA-256 of a size-bound source and refuses oversized inputs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-safe-import-'));
 const db=openDatabase(':memory:');migrateDatabase(db);
 try{
  const source=join(root,'normal.user.js'),oversized=join(root,'huge.user.js');
  const bytes=Buffer.from('// ==UserScript==\n// @name Valid\n// ==/UserScript==\nconst x = document.querySelector("#thing");\r\n','utf8');
  await writeFile(source,bytes);
  await writeFile(oversized,Buffer.alloc(512*1024+1,0x61));
  const result=await importPaths({paths:[source,oversized],recursive:false,repository:createScriptRepository(db)});
  assert.deepEqual(result.map(x=>x.status),['imported','too-large']);
  assert.equal(result[0]?.analysis?.sourceSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await readFile(source),bytes);
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
test('symlinked userscript imports do not access a file outside the selected source',async t=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-safe-import-link-'));
 const db=openDatabase(':memory:');migrateDatabase(db);
 try{
  const secret=join(root,'unselected.user.js'),shortcut=join(root,'selected.user.js');
  await writeFile(secret,'DO NOT IMPORT');
  try{await symlink(secret,shortcut);}catch(e){
   if(['EPERM','EACCES','ENOTSUP'].includes((e as NodeJS.ErrnoException).code??'')){t.skip('Symlinks unavailable');return;}throw e;
  }
  const result=await importPaths({paths:[shortcut],recursive:false,repository:createScriptRepository(db)});
  assert.deepEqual(result.map(x=>x.status),['symlink-skipped']);
  assert.equal(result[0]?.analysis,undefined);
  assert.equal(createScriptRepository(db).list().length,0);
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
