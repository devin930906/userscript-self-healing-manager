import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
test('Electron Main cancels in-flight CDP evidence before persistence, not just journal status',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 assert.match(main,/DiagnosisRequestGate/);
 assert.match(main,/diagnosisRequests\.invalidateAll\(\)/);
 const cancelled=main.slice(main.indexOf("ipcMain.handle('usshm:diagnosis-cancel'"),main.indexOf("ipcMain.handle('usshm:batch-diagnose'"));
 assert.match(cancelled,/diagnosisRequests\.cancel\(\{scanId:q\.scanId,targetId:q\.targetId\}\)/);
 const batch=main.slice(main.indexOf("ipcMain.handle('usshm:batch-diagnose'"),main.indexOf("ipcMain.handle('usshm:read-only-visibility'"));
 assert.match(batch,/diagnosisRequests\.begin\(\{scanId:q\.scanId,targetId:q\.targetId,offset\}\)/);
 assert.match(batch,/diagnosisRequests\.assertCurrent\(ticket\)/);
 assert.match(batch,/diagnosisRequests\.complete\(ticket,\{pageItems:checked\.length,totalItems:scanSnapshot\.items\.length\}\)/);
 assert.match(batch,/diagnosisRequests\.failIfCurrent\(ticket\)/);
});
test('renderer sends explicit cancel IPC as soon as user clicks cancel, even with one page in flight',async()=>{
 const renderer=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 const cancelText=renderer.indexOf('取消剩余检查');
 assert.ok(cancelText>0);
 const control=renderer.slice(cancelText-340,cancelText+80);
 assert.match(control,/cancelDiagnosis\(\{scanId:result\.scanId,targetId\}\)/,
 'sending only local BatchPauseGate.cancel cannot stop an in-flight Main CDP page from being persisted');
});
