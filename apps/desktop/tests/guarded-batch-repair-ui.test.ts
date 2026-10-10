import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('guarded batch repair IPC pins every index from Main-owned approved preview and verified document',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:apply-batch-repair-guarded'");
 const end=main.indexOf("ipcMain.handle('usshm:apply-repair-guarded'",start);
 assert.ok(start>=0&&end>start);
 const x=main.slice(start,end);
 for(const re of [
  /assertSender\(event\)/,/q\.approved!==true/,
  /scanSessions\.require\(/,/pendingApprovals\.require\(/,
  /batchRepairs\.inspectPending\(/,/withinAuthorized\(item\.path\)/,
  /readPinnedRegularFile\(/,/sourceSha256/,
  /getVerifiedChromeStatus\(/,/checkUserscriptPageScope\(/,
  /confirmPageIdentity\(/,/guardAppliedManagedBatchRevision\(/,
  /selectorIndexes:trusted\.selectorIndexes/,
  /readVerifiedManagedLocator\(/,/runReadOnlyDomContract\(/,
  /expectation:'unique'/,/batchRepairs\.restore\(/,
  /scanSessions\.assertCurrent\(/,
  /pendingApprovals\.consume\(/,
 ]){
  assert.match(x,re);
 }
 assert.doesNotMatch(x,/q\.selectorIndexes|q\.previousHash|q\.sourcePath|Runtime\.evaluate|Input\.dispatchMouseEvent/);
});
test('typed preload and UI keep direct unguarded batch save separate from fail-closed guarded save',async()=>{
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(preload,/applyBatchRepairGuarded:.*ipcRenderer\.invoke\('usshm:apply-batch-repair-guarded',input\)/);
 assert.match(ui,/await window\.ussm\.applyBatchRepairGuarded\(/);
 assert.match(ui,/批准保存并双次核验批量修复/);
 assert.match(ui,/rolled-back-v1/);
 assert.match(ui,/rollback-blocked/);
 assert.match(ui,/V2\/V3\/V4/);
});
