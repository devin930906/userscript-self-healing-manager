import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('managed archive health status is main-owned read-only and bound to authorized scanned script',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:managed-health'");
 const end=main.indexOf("ipcMain.handle('usshm:managed-revisions'",start);
 assert.ok(start>=0&&end>start);
 const handler=main.slice(start,end);
 for(const pattern of [/assertSender\(event\)/,/scanSessions\.require\(q\.scanId\)/,
  /withinAuthorized\(item\.path\)/,/inspectManagedIntegrity\(/])
  assert.match(handler,pattern);
 assert.doesNotMatch(handler,/q\.scriptId|q\.path|unlink|rm\(|rmdir|Runtime\.evaluate/,
  'renderer must never supply raw paths or clear crash locks via health IPC');
});

test('native bridge and renderer expose explicit managed integrity inspection with no auto recovery',async()=>{
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(preload,/inspectManagedIntegrity:.*ipcRenderer\.invoke\('usshm:managed-health',input\)/);
 assert.match(ui,/window\.ussm\.inspectManagedIntegrity\(/);
 assert.match(ui,/检查受管资料完整性/);
 assert.match(ui,/write-locked/);
 assert.match(ui,/不会自动删除锁/);
});
