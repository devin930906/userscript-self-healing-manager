import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('read-only direct event-listener evidence is explicit consent and script scoped in Main',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:read-only-event-listeners'")[1]?.split("ipcMain.handle('usshm:run-dom-contract'")[0]??'';
 assert.ok(handler,'Main handler must exist');
 assert.match(handler,/assertSender\(event\)/);
 assert.match(handler,/approved!==true/);
 assert.match(handler,/scanSessions\.require/);
 assert.match(handler,/withinAuthorized/);
 assert.match(handler,/runtimeRequired/);
 assert.match(handler,/checkUserscriptPageScope/);
 assert.match(handler,/confirmPageIdentity/);
 assert.match(handler,/assertStablePageDocument/);
 assert.match(handler,/inspectReadOnlyEventListeners/);
 assert.match(handler,/scanSessions\.assertCurrent/);
 assert.doesNotMatch(handler,/Input\.dispatch|Runtime\.evaluate|executeJavaScript/);
});
test('Preload and renderer expose read-only listener registration inspection, not a V2 functional pass',async()=>{
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(preload,/inspectEventListeners:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:read-only-event-listeners'/);
 assert.match(ui,/inspectEventListeners/);
 assert.match(ui,/检查事件监听器/);
 assert.match(ui,/直接 click 监听器/);
 assert.match(ui,/不能证明实际点击或 GM 功能/);
});
