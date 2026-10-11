import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('trusted Electron Main rechecks on-disk managed active hash after both guarded V1 paths',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const handlers=[
  ["ipcMain.handle('usshm:apply-batch-repair-guarded'","ipcMain.handle('usshm:apply-repair-guarded'"],
  ["ipcMain.handle('usshm:apply-repair-guarded'","ipcMain.handle('usshm:apply-repair'"],
 ];
 for(const [begin,end] of handlers){
  const i=main.indexOf(begin),j=main.indexOf(end,i+1);
  assert.ok(i>0&&j>i,begin);
  const handler=main.slice(i,j);
  assert.match(handler,/confirmActiveHash:\s*async\s*\(\)\s*=>/,
   'Verified DOM-only evidence must be followed by a trusted on-disk active revision check');
  assert.match(handler,/inspectManagedIntegrity\(\{/);
  assert.match(handler,/scanSessions\.assertCurrent\(scanSnapshot\)/);
  assert.doesNotMatch(handler,/q\.activeHash|q\.currentHash|q\.managedPath/,
   'Renderer cannot forge the current-revision hash, disk path or confirmation');
 }
});
