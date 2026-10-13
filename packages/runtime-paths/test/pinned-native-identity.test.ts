import assert from 'node:assert/strict';
import {mkdtemp,writeFile,lstat,readFile,rm} from 'node:fs/promises';
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
  // Model an old Windows file ID that rounds to the same JS-number value.
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
  const good={maxBytes:512*1024,expected:rounded,expectedNative:native}
   as Parameters<typeof readPinnedRegularFile>[1];
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
