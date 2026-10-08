import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('bulk candidate UI is bounded, consented and never performs implicit patch apply',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 const handler=main.split("ipcMain.handle('usshm:suggest-repairs-bulk'")[1]?.split("ipcMain.handle('usshm:propose-repair'")[0]??'';
 assert.match(handler,/assertSender\(event\)/);
 assert.match(handler,/q\.approved!==true/);
 assert.match(handler,/withinAuthorized\(item\.path\)/);
 assert.match(handler,/checkUserscriptPageScope/);
 assert.match(handler,/await confirmPageIdentity\(selected\)/);
 assert.match(handler,/suggestMissingCandidatesBulk/);
 assert.match(handler,/offset:q\.offset/);
 assert.match(handler,/q\.offset%8/);
 assert.doesNotMatch(handler,/applyManagedPatch|repairs\.apply|writeFile\(/);
 assert.match(preload,/suggestRepairsBulk:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:suggest-repairs-bulk'/);
 assert.match(ui,/批量生成修复候选（最多 8 处）/);
 assert.match(ui,/setRepairIndex\(row\.selectorIndex\)/);
 assert.match(ui,/继续下一组修复候选/);
 assert.match(ui,/suggestBulkRepairs\(bulkRepairResults\.checkedMissing\)/);
});
