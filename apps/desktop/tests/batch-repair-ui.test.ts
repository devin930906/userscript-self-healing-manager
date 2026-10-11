import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
test('batch Main IPC maps authorized scanned selector indexes to trusted original AST positions',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const first=main.indexOf("ipcMain.handle('usshm:propose-batch-repair'");
 const second=main.indexOf("ipcMain.handle('usshm:apply-batch-repair'",first);
 const end=main.indexOf("ipcMain.handle('usshm:apply-repair-guarded'",second);
 assert.ok(first>=0&&second>first&&end>second);
 const propose=main.slice(first,second),apply=main.slice(second,end);
 for(const pattern of [/assertSender\(event\)/,/scanSessions\.require\(/,
   /withinAuthorized\(item\.path\)/,/selectorRecords/,/sourceRange\.start\.line/,
   /sourceRange\.start\.column/,/readPinnedRegularFile\(/,
   /sourceSha256/,/batchRepairs\.proposeBatch\(/,/pendingApprovals\.register\(/])
  assert.match(propose,pattern);
 assert.doesNotMatch(propose,/q\.sourcePath|q\.scriptId|eval\(|Runtime\.evaluate|Input\.dispatchMouseEvent/);
 for(const pattern of [/assertSender\(event\)/,/approved!==true/,/pendingApprovals\.require\(/,
   /batchRepairs\.inspectPending\(/,/withinAuthorized\(/,
   /batchRepairs\.applyBatch\(/,/pendingApprovals\.consume\(/])
  assert.match(apply,pattern);
 assert.doesNotMatch(apply,/q\.sourcePath|q\.scriptId|q\.previousHash|q\.proposedHash|Runtime\.evaluate/);
});
test('batch approved repair is a distinct preview/approval bridge; no unchecked source path is exposed',async()=>{
 const pre=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(pre,/proposeBatchRepair:.*ipcRenderer\.invoke\('usshm:propose-batch-repair',input\)/);
 assert.match(pre,/applyBatchRepair:.*ipcRenderer\.invoke\('usshm:apply-batch-repair',input\)/);
 assert.match(ui,/await window\.ussm\.proposeBatchRepair\(/);
 assert.match(ui,/await window\.ussm\.applyBatchRepair\(/);
 assert.match(ui,/批量修复预览/);
 assert.match(ui,/批准保存批量修复/);
 assert.doesNotMatch(pre,/proposeBatchRepair:[^\n]*sourcePath/);
});
