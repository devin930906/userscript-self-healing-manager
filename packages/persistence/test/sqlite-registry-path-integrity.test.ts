import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,symlink,link,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/index.ts';

async function sandbox(fn:(root:string)=>Promise<void>):Promise<void>{
 const root=await mkdtemp(join(tmpdir(),'usshm-registry-alias-'));
 try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06 registry SQLite initialization must not follow a hardlink to a separate database',async()=>sandbox(async root=>{
 const external=join(root,'external.sqlite');
 const original=openDatabase(external);original.close();
 const before=await readFile(external);
 const data=join(root,'Data');await mkdir(data);
 const target=join(data,'registry.sqlite');await link(external,target);
 assert.throws(()=>openDatabase(target),/unsafe|link|alias/i);
 assert.deepEqual(await readFile(external),before);
}));

test('RG-06 registry SQLite initialization refuses a linked executable Data directory',async t=>sandbox(async root=>{
 const external=join(root,'outside-data'),redirect=join(root,'redirect');
 await mkdir(external);
 try{await symlink(external,redirect,'dir');}
 catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('directory symlink unsupported');return;}throw error;}
 assert.throws(()=>openDatabase(join(redirect,'registry.sqlite')),
  /unsafe|symlink|directory|linked/i);
 await assert.rejects(readFile(join(external,'registry.sqlite')),{code:'ENOENT'});
}));

test('RG-06 registry SQLite initialization refuses linked DB and WAL/SHM/rollback sidecars',async t=>sandbox(async root=>{
 const data=join(root,'Data');await mkdir(data);
 const external=join(root,'foreign.sqlite');
 const original=openDatabase(external);original.close();
 const alias=join(data,'registry.sqlite');
 try{await symlink(external,alias,'file');}
 catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('file symlink unsupported');return;}throw error;}
 assert.throws(()=>openDatabase(alias),/unsafe|symlink|linked/i);
 await rm(alias);
 const safe=openDatabase(alias);safe.close();
 const sidecarOwner=join(root,'sidecar');await writeFile(sidecarOwner,'external bytes');
 for(const suffix of ['-wal','-shm','-journal']){
  const p=alias+suffix;
  await symlink(sidecarOwner,p,'file');
  try{assert.throws(()=>openDatabase(alias),/unsafe|symlink|linked|sidecar/i);}
  finally{await rm(p,{force:true});}
 }
 assert.equal(await readFile(sidecarOwner,'utf8'),'external bytes');
}));

test('RG-06 registry module continues supporting explicit SQLite in-memory fixtures',()=>{
 const db=openDatabase(':memory:');
 try{db.exec('CREATE TABLE if_not_redirected (id TEXT PRIMARY KEY)');}
 finally{db.close();}
});
