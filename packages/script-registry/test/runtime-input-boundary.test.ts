import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {enumerateScripts,importPaths} from '../src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../persistence/src/index.ts';

test('RG-01 exported importer rejects malformed runtime path and recursion payloads before registry writes',async()=>{
 const db=openDatabase(':memory:');migrateDatabase(db);
 const repository=createScriptRepository(db);
 const canary='PRIVATE_REGISTRY_PAYLOAD_NEVER_LOG';
 const inputs:[string,unknown][]=[
  ['null request',null],
  ['absent paths',{recursive:false,repository}],
  ['non-array paths',{paths:'synthetic.user.js',recursive:false,repository}],
  ['null item',{paths:[null],recursive:false,repository}],
  ['object item',{paths:[{canary}],recursive:false,repository}],
  ['empty path',{paths:[''],recursive:false,repository}],
  ['blank path',{paths:['  '],recursive:false,repository}],
  ['truthy false recursive',{paths:['synthetic.user.js'],recursive:'false',repository}],
  ['truthy true recursive',{paths:['synthetic.user.js'],recursive:'true',repository}],
  ['missing recursive',{paths:['synthetic.user.js'],repository}],
 ];
 try{
  for(const [caseName,input] of inputs){
   await assert.rejects(importPaths(input as Parameters<typeof importPaths>[0]),
    error=>{
     assert.ok(error instanceof Error,caseName);
     assert.equal(error.message,'Invalid script import request',caseName);
     assert.doesNotMatch(error.message,/PRIVATE_REGISTRY_PAYLOAD_NEVER_LOG/);
     return true;
    },caseName);
   assert.equal(repository.list().length,0,caseName+' must not create registry entries');
  }
 }finally{db.close();}
});

test('RG-01 exported enumerator rejects malformed recursion, path array and symlink-policy flags',async()=>{
 const canary='PRIVATE_ENUMERATOR_PAYLOAD_NEVER_LOG';
 const invalid:[string,unknown][]=[
  ['null request',null],
  ['missing paths',{recursive:false,followSymlinks:false}],
  ['non-array paths',{paths:'synthetic.user.js',recursive:false,followSymlinks:false}],
  ['object path',{paths:[{canary}],recursive:false,followSymlinks:false}],
  ['empty path',{paths:[''],recursive:false,followSymlinks:false}],
  ['missing recursive',{paths:['synthetic.user.js'],followSymlinks:false}],
  ['string false recursion',{paths:['synthetic.user.js'],recursive:'false',followSymlinks:false}],
  ['string true recursion',{paths:['synthetic.user.js'],recursive:'true',followSymlinks:false}],
  ['follow symlinks true',{paths:['synthetic.user.js'],recursive:false,followSymlinks:true}],
  ['missing symlink policy',{paths:['synthetic.user.js'],recursive:false}],
 ];
 for(const [caseName,input] of invalid){
  await assert.rejects(enumerateScripts(input as Parameters<typeof enumerateScripts>[0]),
   error=>{
    assert.ok(error instanceof Error,caseName);
    assert.equal(error.message,'Invalid script enumeration request',caseName);
    assert.doesNotMatch(error.message,/PRIVATE_ENUMERATOR_PAYLOAD_NEVER_LOG/);
    return true;
   },caseName);
 }
});

test('RG-01 valid direct-file import and nonrecursive directory discovery remain unaffected',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-registry-runtime-'));
 const db=openDatabase(':memory:');migrateDatabase(db);
 try{
  const top=join(root,'top.user.js'),sub=join(root,'nested');
  await mkdir(sub);
  await writeFile(top,'const top = 1;');
  await writeFile(join(sub,'nested.user.js'),'const nested = 2;');
  const listing=await enumerateScripts({paths:[root],recursive:false,followSymlinks:false,maxEntries:2});
  assert.deepEqual(listing.filter(item=>item.status==='found').map(item=>item.path),[top]);
  const repository=createScriptRepository(db);
  const result=await importPaths({paths:[top],recursive:false,repository,maxFiles:2});
  assert.deepEqual(result.map(item=>item.status),['imported']);
  assert.equal(repository.list().length,1);
  assert.deepEqual(await importPaths({paths:[],recursive:false,repository,maxFiles:2}),[]);
  assert.deepEqual(await enumerateScripts({paths:[],recursive:false,followSymlinks:false}),[]);
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
