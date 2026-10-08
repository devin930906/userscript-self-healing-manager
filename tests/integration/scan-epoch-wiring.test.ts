import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('main IPC replaces each static scan through a generation-safe coordinator',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 assert.match(main,/new ScanSessionCoordinator<ScanBatchResult>/);
 assert.match(main,/scanSessions\.replace\(\(\)=>runStaticScan/);
});
test('every desktop CDP diagnosis IPC page request is tied to a scan epoch before and after awaiting Chrome',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:batch-diagnose'")[1]?.split("ipcMain.handle('usshm:suggest-repair'")[0]??'';
 assert.match(handler,/scanSessions\.require\(q\.scanId\)/);
 assert.match(handler,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.match(handler,/scanSnapshot\.items\.slice\(offset,offset\+25\)/);
 assert.match(handler,/scanSnapshot\.items\.length-offset-checked\.length/);
 assert.doesNotMatch(handler,/lastScan\.items/);
});
test('renderer and isolated preload send scan epoch from the selected scan, not a page index alone',async()=>{
 const renderer=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 assert.match(renderer,/scanId:result\.scanId/);
 assert.match(preload,/batchDiagnose:\(input:\{[^}]*scanId:string/);
});

test('every index-based desktop script action requires a scan epoch, not just an index',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 const routes=[
  ['probe-locators','probeLocators'],
  ['suggest-repair','suggestRepair'],
  ['suggest-repairs-bulk','suggestRepairsBulk'],
  ['propose-repair','proposeRepair'],
  ['managed-revisions','listManagedRevisions'],
  ['export-managed','exportManaged'],
  ['rollback-managed','rollbackManaged'],
 ];
 for(const [route,method] of routes){
  const segment=main.split("ipcMain.handle('usshm:"+route+"'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
  assert.match(segment,/scanSessions\.require\(q\.scanId\)/,route+' must reject obsolete scans before using itemIndex');
  assert.match(preload,new RegExp(method+':\\(input:\\{[^}]*scanId:string'),method+' must require an epoch in the safe preload');
  assert.match(ui,new RegExp('ussm\\.'+method+'\\(\\{[^}]*scanId:result\\.scanId'),method+' must pass the selected scan epoch');
 }
});

test('repair approval is limited to a proposal created under the same scan and consumed once',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 const propose=main.split("ipcMain.handle('usshm:propose-repair'")[1]?.split("ipcMain.handle('usshm:apply-repair'")[0]??'';
 const apply=main.split("ipcMain.handle('usshm:apply-repair'")[1]?.split("ipcMain.handle('usshm:managed-revisions'")[0]??'';
 assert.match(main,/new ProposalApprovalGate\(/);
 assert.match(propose,/pendingApprovals\.register\(proposal\.proposalId,scanSnapshot\.scanId\)/);
 assert.match(apply,/scanSessions\.require\(q\.scanId\)/);
 assert.match(apply,/pendingApprovals\.require\(q\.proposalId,scanSnapshot\.scanId\)/);
 assert.match(apply,/pendingApprovals\.consume\(q\.proposalId\)/);
 assert.match(preload,/applyRepair:\(input:\{scanId:string;/);
 assert.match(ui,/ussm\.applyRepair\(\{scanId:result\.scanId,/);
});
