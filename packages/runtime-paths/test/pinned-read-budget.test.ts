import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readPinnedRegularFile} from '../src/pinned-file.ts';

test('pinned file reader caps descriptor reads, not just the final result size',async()=>{
 // A file may grow after the initial lstat/fstat. A FileHandle.readFile()
 // allocates based on the changing file size, before the maxBytes check.
 // Guard this critical budget invariant even when reproducing the race
 // deterministically on Windows would require privileged instrumentation.
 const source=await readFile(new URL('../src/pinned-file.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/handle\.readFile\s*\(/,
  'Pinned reads must never allocate an unbounded whole-file result');
 assert.match(source,/handle\.read\s*\(/,
  'Pinned reads must enforce the byte budget on the file descriptor itself');

 const root=await mkdtemp(join(tmpdir(),'usshm-pinned-budget-'));
 try{
  const path=join(root,'bounded.user.js');
  const exact=Buffer.alloc(64*1024,0x61);
  await writeFile(path,exact);
  assert.deepEqual(await readPinnedRegularFile(path,{maxBytes:exact.length}),exact);
  await writeFile(path,Buffer.concat([exact,Buffer.from([0x62])]));
  await assert.rejects(readPinnedRegularFile(path,{maxBytes:exact.length}),/size|budget|limit/i);
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});
