import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('read-only visibility is restricted to a scanned static top-document locator on an approved target',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const slice=main.split("ipcMain.handle('usshm:read-only-visibility'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
 assert.match(main,/ipcMain\.handle\('usshm:read-only-visibility'/);
 assert.match(slice,/assertSender\(event\)/);
 assert.match(slice,/q\.approved!==true/);
 assert.match(slice,/scanSessions\.require\(q\.scanId\)/);
 assert.match(slice,/selectorRecords\[q\.selectorIndex\]/);
 assert.match(slice,/record\.receiver!=='document'/);
 assert.match(slice,/checkUserscriptPageScope\(/);
 assert.match(slice,/inspectReadOnlyElementVisibility\(/);
 assert.match(slice,/assertStablePageDocument\(/);
 assert.match(slice,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.doesNotMatch(slice,/Runtime\.evaluate|Input\.dispatch|q\.selector\b|writeFile\(/);
});
test('narrow preload and desktop UI show read-only CSS/box diagnostics without V2 clickability claims',()=>{
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(preload,/inspectElementVisibility:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:read-only-visibility'/);
 assert.match(ui,/只读检查可见性/);
 assert.match(ui,/ussm\.inspectElementVisibility\(/);
 assert.match(ui,/potentially-visible/);
 assert.match(ui,/V2.*未验证/);
 assert.match(ui,/不能证明.*可点击/);
});
