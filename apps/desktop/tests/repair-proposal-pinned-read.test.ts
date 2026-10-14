import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('repair proposal IPC does not re-open a scanned userscript with unbounded path readFile',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const begin=main.indexOf("ipcMain.handle('usshm:propose-repair'");
 const end=main.indexOf("ipcMain.handle('usshm:apply-repair'",begin);
 assert.ok(begin>=0&&end>begin);
 const segment=main.slice(begin,end);
 assert.match(segment,/readPinnedRegularFile\(item\.path,\s*\{maxBytes:512\s*\*\s*1024,expected:sourceInfo,expectedNative:await lstat\(item\.path,\{bigint:true\}\),expectedSha256:item\.analysis\.sourceSha256\}\)/,
  'main must pin a regular-file descriptor and enforce the 512KiB limit while reading the selected source');
 assert.doesNotMatch(segment,/\breadFile\(item\.path\)/,
  'a lstat-to-readFile swap can follow a symlink or allocate unbounded bytes');
 assert.match(segment,/sourceInfo\.isSymbolicLink\(\)/);
 assert.match(segment,/sourceInfo\.isFile\(\)/);
});

test('batch repair proposal binds pinned bytes to scanned SHA-256',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:propose-batch-repair'");
 const end=main.indexOf("ipcMain.handle('usshm:apply-multi-script-batch'",start);
 assert.ok(start>=0&&end>start);
 const handler=main.slice(start,end);
 assert.match(handler,/readPinnedRegularFile\(item\.path,\{maxBytes:512\*1024,expected:info,expectedNative:await lstat\(item\.path,\{bigint:true\}\),expectedSha256:item\.analysis\.sourceSha256\}\)/);
 assert.match(handler,/batchRepairs\.proposeBatch\(/);
});
