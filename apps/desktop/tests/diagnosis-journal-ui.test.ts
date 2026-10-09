import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('Electron main stores authenticated CDP pages in an isolated private SQLite journal',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:batch-diagnose'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
 assert.match(main,/openDiagnosisJournal\(join\(dataRoot,'diagnosis-journal\.sqlite'\)\)/);
 assert.match(main,/app\.on\('before-quit'.*journal\.close\(\)/);
 assert.match(handler,/batchEvidence\.record\(/);
 assert.match(handler,/journal\.recordPage\(/);
 assert.match(handler,/journal\.failIfCurrent\(/);
 assert.match(main,/ipcMain\.handle\('usshm:diagnosis-history'/);
 assert.match(main,/journal\.listRecent\(/);
});
test('trusted preload and renderer show the persisted diagnosis history without arbitrary SQL access',()=>{
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(preload,/listDiagnosisHistory:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:diagnosis-history'/);
 assert.match(ui,/最近批量诊断历史/);
 assert.match(ui,/ussm\.listDiagnosisHistory\(/);
 assert.match(ui,/中断|取消|完成/);
 assert.doesNotMatch(preload,/querySql|executeSql/);
});
test('users can explicitly cancel their current diagnostic history without clearing other runs',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 assert.match(main,/ipcMain\.handle\('usshm:diagnosis-cancel'/);
 assert.match(main,/journal\.cancel\(/);
 assert.match(preload,/cancelDiagnosis:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:diagnosis-cancel'/);
});
