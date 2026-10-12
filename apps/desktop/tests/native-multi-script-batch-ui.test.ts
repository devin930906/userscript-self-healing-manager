import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('FR-030 Main uses explicit native consent and each script separately pinned approval before durable multi-script writing',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const region=main.split("ipcMain.handle('usshm:apply-multi-script-batch'")[1]
  ?.split("ipcMain.handle('usshm:apply-batch-repair'")[0]??'';
 assert.ok(region,'Main must expose one named native multi-script operation');
 for(const rule of [
  /assertSender\(event\)/,
  /pendingApprovals\.require\(/,
  /assertBatchProposalSnapshot\(/,
  /readPinnedRegularFile\(/,
  /sourceSha256/,
  /scanSessions\.assertCurrent\(/,
  /approveAndApplyManagedRevision\(/,
  /dialog\.showMessageBox\(/,
  /executeDurableApprovedBatchSet\(/,
  /batchRepairs\.applyBatch\(/,
  /onRegisterControls:/,
  /pendingApprovals\.consume\(/,
 ])assert.match(region,rule);
 assert.doesNotMatch(region,/Runtime\.evaluate|Input\.dispatch|executeJavaScript|new Function|eval\(/);
});

test('FR-030 preload exposes one named request, no arbitrary callbacks or raw filesystem access',async()=>{
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 assert.match(preload,/applyMultiScriptBatch:\(input:\{scanId:string;jobs:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:apply-multi-script-batch',input\)/);
 assert.doesNotMatch(preload,/applyMultiScriptBatch:[^\n]*=>ipcRenderer\.send\(/);
});

test('FR-030 desktop UI stages different reviewed script identities before one explicit native approval',async()=>{
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(ui,/stagedMultiScriptJobs/);
 assert.match(ui,/window\.ussm\.applyMultiScriptBatch\(/);
 assert.match(ui,/添加当前修复预览到多脚本队列/);
 assert.match(ui,/统一批准执行多脚本修复/);
 assert.match(ui,/脚本.*分别审核|分别审核.*脚本/);
 assert.match(ui,/V2\/V3\/V4 未验证/);
});
