import assert from 'node:assert/strict';
import {mkdtemp,writeFile,link,lstat,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {readPinnedRegularFile} from '../src/pinned-file.ts';

test('RG-06 precise native file identity refuses an old snapshot even if rounded Stats collides',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-native-pinned-'));
 try{
  const path=join(dir,'synthetic.user.js');
  const bytes=Buffer.from('SYNTHETIC_APPROVED_FILE_CONTENT');
  await writeFile(path,bytes);
  const rounded=await lstat(path);
  const native=await lstat(path,{bigint:true});
  assert.equal(typeof native.ino,'bigint');
  // Model a former exact Windows file ID that differs while the supplied
  // lower-precision numeric Stats remains unchanged.
  // The actual path and numeric Stats remain valid; the *exact* former ID does not.
  const oldIdentity=Object.create(native) as typeof native;
  Object.defineProperty(oldIdentity,'ino',{value:native.ino+(1n<<53n)});
  const options={
   maxBytes:512*1024,expected:rounded,expectedNative:oldIdentity,
  } as Parameters<typeof readPinnedRegularFile>[1];
  await assert.rejects(readPinnedRegularFile(path,options),
   /native|identity|snapshot|replaced|changed|unsafe/i,
   'never import a source after its exact approved file ID differs');
  assert.deepEqual(await readFile(path),bytes,'leave original source untouched');
  const good={maxBytes:512*1024,expected:rounded,expectedNative:native} as Parameters<typeof readPinnedRegularFile>[1];
  assert.deepEqual(await readPinnedRegularFile(path,good),bytes,
   'matching precise native snapshot retains legitimate selected-file import');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('RG-06 precise native snapshot refuses forged creation time with unchanged numeric Stats',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-native-birthtime-'));
 try{
  const path=join(dir,'synthetic.user.js');
  await writeFile(path,'SYNTHETIC_NATIVE_CREATION_TIME');
  const rounded=await lstat(path),native=await lstat(path,{bigint:true});
  const oldIdentity=Object.create(native) as typeof native;
  Object.defineProperty(oldIdentity,'birthtimeNs',{value:native.birthtimeNs+1n});
  await assert.rejects(readPinnedRegularFile(path,{
   maxBytes:512*1024,expected:rounded,expectedNative:oldIdentity,
  } as Parameters<typeof readPinnedRegularFile>[1]),/native|identity|snapshot|replaced|changed|unsafe/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('RG-06 numeric pinned snapshot rejects a changed hardlink count with identical other metadata',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-linkcount-rounded-'));
 try{
  const path=join(dir,'synthetic.user.js'),alias=join(dir,'synthetic.alias');
  const bytes=Buffer.from('SYNTHETIC_LINK_COUNT_ONLY');
  await writeFile(path,bytes);await link(path,alias);
  const approved=await lstat(path);
  assert.equal(approved.nlink,2,'fixture must be a real hardlinked file');
  // Model an earlier approved snapshot. All identity fields except link count
  // deliberately match, so the test isolates this missing invariant.
  const stale=Object.create(approved) as typeof approved;
  Object.defineProperty(stale,'nlink',{value:approved.nlink-1});
  await assert.rejects(readPinnedRegularFile(path,{maxBytes:512*1024,expected:stale,expectedNative:await lstat(path,{bigint:true})}),
   /identity|replaced|changed|snapshot|unsafe/i,
   'new hardlink aliases must invalidate a caller-approved numeric snapshot');
  assert.deepEqual(await readPinnedRegularFile(path,{maxBytes:512*1024,expected:approved,expectedNative:await lstat(path,{bigint:true})}),bytes);
  assert.deepEqual(await readFile(alias),bytes,'no aliases are modified during verification');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('RG-06 exact BigInt pinned snapshot rejects changed hardlink count with the same file ID',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-linkcount-native-'));
 try{
  const path=join(dir,'synthetic.user.js'),alias=join(dir,'synthetic.alias');
  const bytes=Buffer.from('SYNTHETIC_NATIVE_LINK_COUNT_ONLY');
  await writeFile(path,bytes);await link(path,alias);
  const numeric=await lstat(path),native=await lstat(path,{bigint:true});
  assert.equal(native.nlink,2n,'fixture must expose a real native hardlink count');
  const stale=Object.create(native) as typeof native;
  Object.defineProperty(stale,'nlink',{value:native.nlink-1n});
  await assert.rejects(readPinnedRegularFile(path,{
   maxBytes:512*1024,expected:numeric,expectedNative:stale,
  }),/native|identity|snapshot|replaced|changed|unsafe/i,
  'a different exact link count must invalidate approved native identity');
  assert.deepEqual(await readPinnedRegularFile(path,{
   maxBytes:512*1024,expected:numeric,expectedNative:native,
  }),bytes,'unchanged hardlinked source remains readable');
  assert.deepEqual(await readFile(alias),bytes,'the reader must never change original bytes');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('RG-06 Windows rejects numeric-only approved file identity but permits exact native approval',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-strict-pinned-'));
 try{
  const path=join(dir,'synthetic.user.js'),bytes=Buffer.from('SYNTHETIC_NUMERIC_COLLISION_GUARD');
  await writeFile(path,bytes);
  const numeric=await lstat(path),precise=await lstat(path,{bigint:true});
  if(process.platform==='win32'){
   await assert.rejects(readPinnedRegularFile(path,{maxBytes:512*1024,expected:numeric}),
    /native|precise|snapshot|identity|unsafe/i,
    'Windows numeric-only metadata cannot distinguish proved rounded identity collisions');
  }else{
   assert.deepEqual(await readPinnedRegularFile(path,{maxBytes:512*1024,expected:numeric}),bytes);
  }
  assert.deepEqual(await readPinnedRegularFile(path,{
   maxBytes:512*1024,expected:numeric,expectedNative:precise,
  }),bytes,'precisely bound source remains readable on all platforms');
 }finally{await rm(dir,{recursive:true,force:true});}
});
