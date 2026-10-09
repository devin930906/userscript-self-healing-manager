import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('guarded managed apply is bound to Main-owned proposal, active scan and approved CDP target',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const begin=main.indexOf("ipcMain.handle('usshm:apply-repair-guarded'");
 const end=main.indexOf("ipcMain.handle('usshm:apply-repair'",begin);
 assert.ok(begin>0&&end>begin);
 const handler=main.slice(begin,end);
 for(const pattern of [/q\.approved!==true/,/scanSessions\.require\(q\.scanId\)/,
  /pendingApprovals\.require\(q\.proposalId,scanSnapshot\.scanId\)/,
  /repairs\.inspectPending\(q\.proposalId\)/,/withinAuthorized\(item\.path\)/,
  /checkUserscriptPageScope\(item\.analysis\.metadata,selected\.url\)/,
  /guardAppliedManagedRevision\(/,/runReadOnlyDomContract\(/,
  /repairs\.restore\(/,/readVerifiedManagedLocator\(/]){
  assert.match(handler,pattern);
 }
 assert.doesNotMatch(handler,/q\.previousHash|q\.appliedHash|Runtime\.evaluate|Input\.dispatchMouseEvent|executeJavaScript/,
  'renderer may not choose rollback hashes or run arbitrary scripts');
});

test('narrow user-approved guarded-save button renders rollback result but never V2-V4 as passed',async()=>{
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const renderer=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(preload,/applyRepairGuarded:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:apply-repair-guarded',input\)/);
 assert.match(renderer,/async function applyRepairGuarded\(/);
 assert.match(renderer,/\.ussm\.applyRepairGuarded\(/);
 assert.match(renderer,/保存并自动 V1 复核，失败恢复上一修订/);
 assert.match(renderer,/rollback-blocked/);
 assert.match(renderer,/V2\/V3\/V4 未验证/);
});
