import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {persistImmutableSnapshot} from '../src/immutable-archive.ts';

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(fn:(dir:string)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'usshm-hash-name-boundary-'));
 try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}

test('RG-06 immutable snapshot refuses non-hash names and mismatched approved bytes without writing',async()=>fixture(async dir=>{
 const bytes=Buffer.from('SYNTHETIC_APPROVED_REVISION_BYTES_ONLY');
 const good=digest(bytes);
 const mismatched=digest(Buffer.from('UNRELATED_BYTES'));
 assert.notEqual(mismatched,good);
 const wrongNames=[
  'current.user.js','backup.user.js','manifest.json',
  'revision-'+mismatched+'.user.js',
  'original-'+mismatched+'.user.js',
  'revision-'+good.toUpperCase()+'.user.js',
  'revision-'+good+'.user.js.backup',
  '../revision-'+mismatched+'.user.js',
 ];
 for(const name of wrongNames){
  let writerCalled=false;
  await assert.rejects(persistImmutableSnapshot({
   archivePath:join(dir,name),bytes,
   writeChunk:async()=>{writerCalled=true;throw new Error('Unexpected write');},
  }),/immutable|archive|hash|name|path|invalid/i,'must reject invalid hash-bound archive name '+name);
  assert.equal(writerCalled,false,'reject unapproved archive name before opening staged output');
  assert.deepEqual(await readdir(dir),[],'reject without creating any revision or staging artifacts');
 }
}));

test('RG-06 immutable snapshots still accept correctly named original and revision archives',async()=>fixture(async dir=>{
 const bytes=Buffer.from('SYNTHETIC_HASH_BOUND_ORIGINAL_AND_REVISION');
 const hash=digest(bytes);
 for(const kind of ['original','revision'] as const){
  const path=join(dir,kind+'-'+hash+'.user.js');
  await persistImmutableSnapshot({archivePath:path,bytes});
  await persistImmutableSnapshot({archivePath:path,bytes});
  assert.deepEqual(await readFile(path),bytes);
 }
 assert.deepEqual((await readdir(dir)).sort(),
  ['original-'+hash+'.user.js','revision-'+hash+'.user.js'].sort());
}));
