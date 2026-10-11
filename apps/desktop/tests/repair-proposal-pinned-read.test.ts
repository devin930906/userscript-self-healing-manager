import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('repair proposal IPC does not re-open a scanned userscript with unbounded path readFile',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const begin=main.indexOf("ipcMain.handle('usshm:propose-repair'");
 const end=main.indexOf("ipcMain.handle('usshm:apply-repair'",begin);
 assert.ok(begin>=0&&end>begin);
 const segment=main.slice(begin,end);
 assert.match(segment,/readPinnedRegularFile\(item\.path,\s*\{maxBytes:512\s*\*\s*1024,expected:sourceInfo\}\)/,
  'main must pin a regular-file descriptor and enforce the 512KiB limit while reading the selected source');
 assert.doesNotMatch(segment,/\breadFile\(item\.path\)/,
  'a lstat-to-readFile swap can follow a symlink or allocate unbounded bytes');
 assert.match(segment,/sourceInfo\.isSymbolicLink\(\)/);
 assert.match(segment,/sourceInfo\.isFile\(\)/);
});
