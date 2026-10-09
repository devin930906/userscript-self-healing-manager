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
 const before=await lstat(path);
 await rename(path,away);
 await writeFile(path,'EVIL BYTES');
 await assert.rejects(readPinnedRegularFile(path,{maxBytes:512*1024,expected:before}),
  /identity|replaced|changed|snapshot|stale|unsafe/i);
 assert.equal(await readFile(away,'utf8'),'SAFE BYTES');
}));

test('pinned reader detects hardlink aliases with mismatched snapshots and bounded size',async()=>fixture(async dir=>{
 const path=join(dir,'archive.user.js'),other=join(dir,'outside.user.js');
 await writeFile(path,'first archive');
 const before=await lstat(path);
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
