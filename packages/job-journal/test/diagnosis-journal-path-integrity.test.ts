import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,mkdir,link,symlink,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDiagnosisJournal} from '../src/index.ts';

async function sandbox(run:(root:string)=>Promise<void>):Promise<void>{
 const root=await mkdtemp(join(tmpdir(),'usshm-diagnosis-alias-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06 diagnosis journal refuses a hardlinked existing SQLite file before startup updates',async()=>sandbox(async root=>{
 const external=join(root,'external-diagnosis.sqlite');
 const original=openDiagnosisJournal(external);original.close();
 const before=await readFile(external);
 const data=join(root,'Data');await mkdir(data);
 const target=join(data,'diagnosis-journal.sqlite');await link(external,target);
 assert.throws(()=>openDiagnosisJournal(target),/unsafe|hardlink|alias|linked/i);
 assert.deepEqual(await readFile(external),before);
}));

test('RG-06 diagnosis journal refuses a linked Data ancestor before creating a database',async t=>sandbox(async root=>{
 const external=join(root,'external-data'),alias=join(root,'linked-data');
 await mkdir(external);
 try{await symlink(external,alias,'dir');}
 catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('directory symlink unsupported');return;}throw error;}
 assert.throws(()=>openDiagnosisJournal(join(alias,'diagnosis-journal.sqlite')),
  /unsafe|symlink|junction|linked|directory/i);
 await assert.rejects(readFile(join(external,'diagnosis-journal.sqlite')),{code:'ENOENT'});
}));

test('RG-06 diagnosis journal rejects a linked main database leaf',async t=>sandbox(async root=>{
 const external=join(root,'external.sqlite');
 const original=openDiagnosisJournal(external);original.close();
 const data=join(root,'Data');await mkdir(data);
 try{await symlink(external,join(data,'diagnosis-journal.sqlite'),'file');}
 catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('file symlink unsupported');return;}throw error;}
 assert.throws(()=>openDiagnosisJournal(join(data,'diagnosis-journal.sqlite')),
  /unsafe|symlink|linked|alias/i);
}));

test('RG-06 diagnosis journal refuses linked SQLite sidecars instead of normalizing them',async t=>sandbox(async root=>{
 const data=join(root,'Data');await mkdir(data);
 const target=join(data,'diagnosis-journal.sqlite');
 const original=openDiagnosisJournal(target);original.close();
 const external=join(root,'outside-sidecar');await writeFile(external,'external-bytes');
 for(const suffix of ['-wal','-shm','-journal']){
  const sidecar=target+suffix;
  try{await symlink(external,sidecar,'file');}
  catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('sidecar symlink unsupported');return;}throw error;}
  try{assert.throws(()=>openDiagnosisJournal(target),/unsafe|symlink|linked|sidecar/i);}
  finally{await rm(sidecar,{force:true});}
 }
 assert.equal(await readFile(external,'utf8'),'external-bytes');
}));
