import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {enumerateScripts,importPaths} from '../src/index.ts';
import {runStaticScan} from '../../scan-service/src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository,type ScriptRecord} from '../../persistence/src/index.ts';

test('RG-07 selected and discovered unreadable paths preserve safe error codes without leaking local directories',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-private-import-'));
 const secret='PRIVATE_ACCOUNT_FOLDER_NOT_FOR_EXPORT';
 const missing=join(root,secret,'missing.user.js');
 const db=openDatabase(':memory:');migrateDatabase(db);
 try{
  const discovered=await enumerateScripts({paths:[missing],recursive:false,followSymlinks:false});
  assert.equal(discovered[0]?.status,'unreadable');
  assert.match(discovered[0]?.message??'',/ENOENT|unreadable/i);
  assert.doesNotMatch(discovered[0]?.message??'',/PRIVATE_ACCOUNT_FOLDER_NOT_FOR_EXPORT/);
  assert.doesNotMatch(discovered[0]?.message??'',new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));

  const repo=createScriptRepository(db);
  const results=await importPaths({paths:[missing],recursive:false,repository:repo});
  assert.equal(results[0]?.status,'unreadable');
  assert.match(results[0]?.message??'',/ENOENT|unreadable/i);
  assert.doesNotMatch(results[0]?.message??'',/PRIVATE_ACCOUNT_FOLDER_NOT_FOR_EXPORT/);

  const scan=await runStaticScan({paths:[missing],recursive:false,maxFiles:1},{repository:repo});
  assert.equal(scan.items[0]?.status,'unreadable');
  assert.ok(scan.items[0]?.diagnostics.length);
  assert.doesNotMatch(JSON.stringify(scan.items[0]?.diagnostics),/PRIVATE_ACCOUNT_FOLDER_NOT_FOR_EXPORT/);
  assert.deepEqual(repo.list(),[]);
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});

test('RG-07 registry lookup and write failures retain a safe code and isolate healthy sibling imports',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-registry-private-diagnostics-'));
 const db=openDatabase(':memory:');migrateDatabase(db);
 const secret='SECRET_DATABASE_KEY_AND_PRIVATE_PATH_456';
 try{
  const sources=['lookup.user.js','write.user.js','ok.user.js'].map(name=>join(root,name));
  for(const path of sources)await writeFile(path,'// ==UserScript==\n// @name Privacy fixture\n// ==/UserScript==\nconst value=1;\n');
  const originals=await Promise.all(sources.map(path=>readFile(path)));
  const actual=createScriptRepository(db);
  const blocked={
   ...actual,
   findIdByPath(path:string):string|undefined{
    if(path===sources[0])throw new Error('SQLITE_BUSY: '+secret+' /private/path');
    return actual.findIdByPath(path);
   },
   upsert(record:ScriptRecord):void{
    if(record.path===sources[1])throw new Error('SQLITE_READONLY: '+secret+' account@example.invalid');
    actual.upsert(record);
   },
  };
  const results=await importPaths({paths:sources,recursive:false,repository:blocked});
  assert.deepEqual(results.map(x=>x.status),['unreadable','unreadable','imported']);
  assert.match(results[0]?.message??'',/registry lookup failed.*SQLITE_BUSY/i);
  assert.match(results[1]?.message??'',/registry write failed.*SQLITE_READONLY/i);
  for(const result of results){
   assert.doesNotMatch(result.message??'',/SECRET_DATABASE_KEY_AND_PRIVATE_PATH_456|account@example|\/private\/path/);
  }
  assert.equal(results[0]?.analysis,undefined);
  assert.equal(results[1]?.scriptId,undefined);
  assert.ok(results[2]?.scriptId);
  assert.equal(actual.list().length,1);
  for(const [i,path] of sources.entries())assert.deepEqual(await readFile(path),originals[i]);
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
