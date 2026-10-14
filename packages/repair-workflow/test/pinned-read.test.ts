import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {mkdtemp,writeFile,readFile,rename,symlink,link,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';

async function fixture<T>(run:(dir:string)=>Promise<T>):Promise<T>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-pinned-'));
 try{return await run(dir);}finally{await rm(dir,{recursive:true,force:true});}
}

test('pinned reader returns unmodified bytes for an ordinary bounded userscript',async()=>fixture(async dir=>{
 const path=join(dir,'ordinary.user.js');
 const bytes=Buffer.from([0xef,0xbb,0xbf,0x2f,0x2f,0x0d,0x0a,0x61]);
 await writeFile(path,bytes);
 const result=await readPinnedRegularFile(path,{maxBytes:512*1024});
 assert.deepEqual(result,bytes);
}));

test('pinned reader rejects a symlink and leaves the outside file untouched',async()=>fixture(async dir=>{
 const outside=join(dir,'protected.txt'),path=join(dir,'import.user.js');
 await writeFile(outside,'OUTSIDE DO NOT READ');
 await symlink(outside,path,'file');
 await assert.rejects(readPinnedRegularFile(path,{maxBytes:512*1024}),/symlink|unsafe|identity|ordinary/i);
 assert.equal(await readFile(outside,'utf8'),'OUTSIDE DO NOT READ');
}));

test('pinned reader catches same-size path swaps even when the old snapshot was valid',async()=>fixture(async dir=>{
 const path=join(dir,'source.user.js'),away=join(dir,'renamed.user.js');
 await writeFile(path,'SAFE BYTES');
 const before=await lstat(path),nativeBefore=await lstat(path,{bigint:true});
 await rename(path,away);
 await writeFile(path,'EVIL BYTES');
 await assert.rejects(readPinnedRegularFile(path,{maxBytes:512*1024,expected:before,expectedNative:nativeBefore}),
  /identity|replaced|changed|snapshot|stale|unsafe/i);
 assert.equal(await readFile(away,'utf8'),'SAFE BYTES');
}));

test('pinned reader detects hardlink aliases with mismatched snapshots and bounded size',async()=>fixture(async dir=>{
 const path=join(dir,'archive.user.js'),other=join(dir,'outside.user.js');
 await writeFile(path,'first archive');
 const before=await lstat(path),nativeBefore=await lstat(path,{bigint:true});
 await writeFile(other,'separate content');
 await rm(path);
 await link(other,path);
 await assert.rejects(readPinnedRegularFile(path,{maxBytes:512*1024,expected:before}),
  /identity|replaced|changed|snapshot|stale|unsafe/i);
 await assert.rejects(readPinnedRegularFile(path,{maxBytes:4}),/large|size|budget|limit/i);
}));

test('pinned reader rejects non-file objects and zero/unsafe budgets',async()=>fixture(async dir=>{
 const path=join(dir,'directory');
 const file=join(dir,'file.user.js');
 await writeFile(file,'ok');
 await assert.rejects(readPinnedRegularFile(dir,{maxBytes:100}),/file|ordinary|regular|unsafe/i);
 await assert.rejects(readPinnedRegularFile(file,{maxBytes:0}),/limit|budget|size|invalid/i);
 await assert.rejects(readPinnedRegularFile(file,{maxBytes:2**40}),/limit|budget|size|invalid/i);
}));

test('pinned reader rejects changed creation time even when ino size mode mtime and ctime match',async()=>fixture(async dir=>{
 const path=join(dir,'birthtime-pinned.user.js');
 const original='SYNTHETIC_MANAGED_BYTES';
 await writeFile(path,original);
 const approved=await lstat(path);
 assert.ok(Number.isFinite(approved.birthtimeMs),'fixture must expose file creation metadata');
 // Model an approved snapshot for another file whose inode/timestamp happened
 // to alias a replaced file. Every other Stat field is unchanged.
 const stale=Object.create(approved) as typeof approved;
 Object.defineProperty(stale,'birthtimeMs',{value:approved.birthtimeMs+120_000});
 await assert.rejects(readPinnedRegularFile(path,{maxBytes:512*1024,expected:stale,expectedNative:await lstat(path,{bigint:true})}),
  /identity|replaced|snapshot|stale|changed/i,
  'different file creation identity may not inherit an old reviewed snapshot');
 assert.equal(await readFile(path,'utf8'),original,'never change original scripts');
 assert.deepEqual(await readPinnedRegularFile(path,{maxBytes:512*1024,expected:approved,expectedNative:await lstat(path,{bigint:true})}),
  Buffer.from(original),'normal unchanged snapshot remains readable');
}));

test('RG-06 repeated same-size file replacement never inherits a previously approved native snapshot',async()=>fixture(async dir=>{
 const path=join(dir,'repeated.user.js'),away=join(dir,'previous.user.js');
 for(let iteration=0;iteration<12;iteration++){
  const original='SAFE'+String(iteration).padStart(4,'0');
  const replacement='EVIL'+String(iteration).padStart(4,'0');
  await writeFile(path,original);
  const expected=await lstat(path),expectedNative=await lstat(path,{bigint:true});
  await rename(path,away);
  await writeFile(path,replacement);
  try{
   await assert.rejects(
    readPinnedRegularFile(path,{maxBytes:512*1024,expected,expectedNative}),
    /identity|replaced|changed|snapshot|stale|unsafe/i,
   );
  }catch(error){
   // Only synthetic file metadata; no real scripts, paths or private DOM.
   const actual=await lstat(path),actualNative=await lstat(path,{bigint:true});
   const fields=(v:typeof actual)=>({dev:v.dev,ino:v.ino,size:v.size,
    birthtimeMs:v.birthtimeMs,mtimeMs:v.mtimeMs,ctimeMs:v.ctimeMs});
   throw new Error('synthetic swap '+iteration+' metadata '+JSON.stringify({
    approved:fields(expected),replacement:fields(actual),
    nativeInodeEqual:expectedNative.ino===actualNative.ino,
    nativeBirthEqual:expectedNative.birthtimeNs===actualNative.birthtimeNs,
   }),{cause:error});
  }
  assert.equal(await readFile(away,'utf8'),original);
  await rm(path);
  await rm(away);
 }
}));

test('RG-06 rejects a stale precise native snapshot even if rounded Stats still match',async()=>fixture(async dir=>{
 const path=join(dir,'precise-snapshot.user.js');
 const original=Buffer.from('SYNTHETIC_APPROVED_FILE');
 await writeFile(path,original);
 const numeric=await lstat(path);
 const native=await lstat(path,{bigint:true});
 const stale=Object.create(native) as typeof native;
 Object.defineProperty(stale,'ino',{value:native.ino+1n});
 await assert.rejects(
  readPinnedRegularFile(path,{maxBytes:512*1024,expected:numeric,expectedNative:stale}),
  /precise|identity|snapshot|changed|replaced/i,
 );
 assert.deepEqual(await readFile(path),original,'failed authorization must not mutate the source');
 assert.deepEqual(
  await readPinnedRegularFile(path,{maxBytes:512*1024,expected:numeric,expectedNative:native}),
  original,'unchanged precise native snapshot remains readable',
 );
}));

test('RG-06 rejects stale precise native creation and change times independently of rounded Stats',async()=>fixture(async dir=>{
 const path=join(dir,'native-timestamps.user.js');
 const original=Buffer.from('SYNTHETIC_NATIVE_TIMESTAMP');
 await writeFile(path,original);
 const numeric=await lstat(path),native=await lstat(path,{bigint:true});
 for(const field of ['birthtimeNs','ctimeNs','mtimeNs'] as const){
  const stale=Object.create(native) as typeof native;
  Object.defineProperty(stale,field,{value:native[field]+1n});
  await assert.rejects(
   readPinnedRegularFile(path,{maxBytes:512*1024,expected:numeric,expectedNative:stale}),
   /precise|identity|snapshot|changed|replaced/i,
   field+' mismatch must fail closed',
  );
  assert.deepEqual(await readFile(path),original);
 }
 assert.deepEqual(
  await readPinnedRegularFile(path,{maxBytes:512*1024,expected:numeric,expectedNative:native}),
  original,
 );
}));

test('RG-06 rejects stale precise native device link and mode snapshots without mutating source',async()=>fixture(async dir=>{
 const path=join(dir,'native-metadata.user.js');
 const original=Buffer.from('SYNTHETIC_NATIVE_METADATA');
 await writeFile(path,original);
 const numeric=await lstat(path),native=await lstat(path,{bigint:true});
 for(const field of ['dev','nlink','mode','size'] as const){
  const stale=Object.create(native) as typeof native;
  Object.defineProperty(stale,field,{value:native[field]+1n});
  await assert.rejects(
   readPinnedRegularFile(path,{maxBytes:512*1024,expected:numeric,expectedNative:stale}),
   /precise|identity|snapshot|changed|replaced/i,
   field+' mismatch must fail closed',
  );
  assert.deepEqual(await readFile(path),original);
 }
 assert.deepEqual(await readPinnedRegularFile(path,{
  maxBytes:512*1024,expected:numeric,expectedNative:native,
 }),original);
}));

test('RG-06 rejects malformed precise native snapshot types without touching source',async()=>fixture(async dir=>{
 const path=join(dir,'malformed-native.user.js');
 const original=Buffer.from('SYNTHETIC_MALFORMED_NATIVE');
 await writeFile(path,original);
 const numeric=await lstat(path),native=await lstat(path,{bigint:true});
 for(const field of ['ino','dev','size','birthtimeNs','mtimeNs','ctimeNs','mode'] as const){
  const malformed=Object.create(native) as typeof native;
  Object.defineProperty(malformed,field,{value:1});
  await assert.rejects(
   readPinnedRegularFile(path,{maxBytes:512*1024,expected:numeric,expectedNative:malformed}),
   /precise|identity|snapshot|changed|replaced/i,
   field+' must be bigint',
  );
  assert.deepEqual(await readFile(path),original);
 }
 assert.deepEqual(await readPinnedRegularFile(path,{
  maxBytes:512*1024,expected:numeric,expectedNative:native,
 }),original);
}));

test('RG-06 rejects malformed native hardlink count before reading a pinned source',async()=>fixture(async dir=>{
 const path=join(dir,'native-links.user.js');
 const original=Buffer.from('SYNTHETIC_HARDLINK_METADATA');
 await writeFile(path,original);
 const numeric=await lstat(path),native=await lstat(path,{bigint:true});
 for(const invalid of [1,undefined,null]){
  const malformed=Object.create(native) as typeof native;
  Object.defineProperty(malformed,'nlink',{value:invalid});
  await assert.rejects(readPinnedRegularFile(path,{
   maxBytes:512*1024,expected:numeric,expectedNative:malformed,
  }),/precise|identity|snapshot/i);
  assert.deepEqual(await readFile(path),original);
 }
 assert.deepEqual(await readPinnedRegularFile(path,{
  maxBytes:512*1024,expected:numeric,expectedNative:native,
 }),original);
}));
