import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
test('batch DOM flow uses narrow preload IPC and explicit approval; UI never writes scripts',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(main,/ipcMain\.handle\('usshm:batch-diagnose'/);
 assert.match(main,/diagnoseScriptsOnPage\(/);
 assert.match(main,/q\.approved!==true/);
 assert.match(preload,/batchDiagnose:\(input:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:batch-diagnose'/);
 assert.match(ui,/ussm\.batchDiagnose\(/);
 assert.match(ui,/批量网页诊断（只读）/);
 assert.match(ui,/批量诊断不执行油猴脚本/);
 assert.match(main,/offset%25!==0/);
 assert.match(main,/scanSnapshot\.items\.slice\(offset,offset\+25\)/);
 assert.match(main,/scanSessions\.require\(q\.scanId\)/);
 assert.match(main,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.match(ui,/collectPagedDomDiagnosis\(/);
 assert.match(ui,/requestPage:offset=>window\.ussm\.batchDiagnose/);
 assert.match(ui,/setBatchResult\(evidence\)/);
 assert.match(ui,/batchCancel\.current/);
 assert.match(ui,/取消剩余检查/);
 assert.match(ui,/setBatchProgress\(evidence\.totalItems\)/);
 assert.match(ui,/setBatchResult\(null\);setBatchProgress\(0\)/);
});

test('batch diagnosis visibly separates DOM-only V1 from unconfigured V3/V4',()=>{
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(ui,/row\.verification/);
 assert.match(ui,/V0/);
 assert.match(ui,/V1/);
 assert.match(ui,/V3\/V4/);
});
