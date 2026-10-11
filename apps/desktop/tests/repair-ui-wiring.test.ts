import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
test('patch IPC uses authorized imported script and hash guard',async()=>{
 const m=await readFile('apps/desktop/src/main/index.ts','utf8');
 assert.match(m,/ipcMain\.handle\('usshm:propose-repair'/);
 assert.match(m,/ipcMain\.handle\('usshm:apply-repair'/);
 assert.match(m,/scanSnapshot\.items\[/);
 assert.match(m,/withinAuthorized\(item\.path\)/);
 assert.match(m,/sourceSha256/);
});
test('patch UI requires preview and approval without overwriting original',async()=>{
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(ui,/生成修复预览/);
 assert.match(ui,/审核后保存受管副本/);
 assert.match(ui,/不会覆盖原始脚本/);
});
test('preload exposes named proposal and approval only',async()=>{
 const p=await readFile('apps/desktop/src/preload/index.ts','utf8');
 assert.match(p,/proposeRepair:/);
 assert.match(p,/applyRepair:/);
 assert.ok(!p.includes('writeFile('));
});

test('desktop IPC validates stable original source hash rather than rejecting a second managed repair',async()=>{
 const m=await readFile('apps/desktop/src/main/index.ts','utf8');
 const ipc=m.split("ipcMain.handle('usshm:propose-repair'")[1]?.split("ipcMain.handle('usshm:apply-repair'")[0]??'';
 assert.match(ipc,/proposal\.originalHash!==item\.analysis\.sourceSha256/);
 assert.doesNotMatch(ipc,/proposal\.baseHash!==item\.analysis\.sourceSha256/);
});
