import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectReleaseZipEntryTypes} from '../../scripts/windows-release-gate.mjs';

/**
 * Deliberately central-directory-only ZIP fixtures. These exercise the
 * inspection API independently of tar.exe and without unpacking any data.
 */
function centralDirectoryZip(names: readonly (string | Buffer)[]): Buffer {
 const records=names.map(input=>{
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input,'utf8');
  const record=Buffer.alloc(46+bytes.length);
  record.writeUInt32LE(0x02014b50,0);
  record.writeUInt16LE(20,4);
  record.writeUInt16LE(20,6);
  record.writeUInt16LE(8,10);
  record.writeUInt32LE(1,20);
  record.writeUInt32LE(2,24);
  record.writeUInt16LE(bytes.length,28);
  record.writeUInt32LE(0x20,38);
  bytes.copy(record,46);
  return record;
 });
 const central=Buffer.concat(records);
 const end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);
 end.writeUInt16LE(names.length,8);
 end.writeUInt16LE(names.length,10);
 end.writeUInt32LE(central.length,12);
 end.writeUInt32LE(0,16);
 return Buffer.concat([central,end]);
}

test('ZIP central-directory inspector independently rejects unsafe path and non-UTF8 names',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-zip-central-path-'));
 const file=join(dir,'candidate.zip');
 try{
  await writeFile(file,centralDirectoryZip(['resources/app.asar','locales/en-US.pak']));
  assert.equal((await inspectReleaseZipEntryTypes(file)).entryCount,2);
  const hostileNames:(string|Buffer)[]=[
   '../outside.txt',
   'resources/../outside.txt',
   'resources\\..\\outside.txt',
   'Data/registry.sqlite',
   'resources/secret.user.js',
   'resources/.env',
   'resources/app.asar:alternate',
   'resources/CON.txt',
   'resources/evil\u202Eexe.txt',
   Buffer.from([0x72,0x65,0x73,0x2f,0xc3,0x28]),
  ];
  for(const hostile of hostileNames){
   await writeFile(file,centralDirectoryZip(['resources/app.asar',hostile]));
   await assert.rejects(inspectReleaseZipEntryTypes(file),
    /unsafe|ZIP|UTF-8|path|private|reserved|duplicate|invalid|forbidden/i,
    'Central-directory validation must reject '+String(hostile));
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('ZIP central-directory inspector rejects case-insensitive duplicate extraction destinations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-zip-central-duplicate-'));
 const file=join(dir,'candidate.zip');
 try{
  for(const names of [
   ['resources/app.asar','Resources/APP.ASAR'],
   ['locales/','LOCALES/'],
   ['resources/app.asar','resources/app.asar'],
  ]){
   await writeFile(file,centralDirectoryZip(names));
   await assert.rejects(inspectReleaseZipEntryTypes(file),
    /duplicate|collid|unsafe|ZIP|path/i);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
