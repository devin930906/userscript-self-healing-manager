import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('Electron DOM contract IPC binds only a scanned document locator, explicit target and user consent',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:run-dom-contract'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
 assert.match(main,/ipcMain\.handle\('usshm:run-dom-contract'/);
 assert.match(handler,/assertSender\(event\)/);
 assert.match(handler,/q\.approved!==true/);
 assert.match(handler,/scanSessions\.require\(q\.scanId\)/);
 assert.match(handler,/selectorRecords\[q\.selectorIndex\]/);
 assert.match(handler,/receiver!=='document'/);
 assert.match(handler,/checkUserscriptPageScope\(/);
 assert.match(handler,/runReadOnlyDomContract\(/);
 assert.match(handler,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.doesNotMatch(handler,/q\.locator\b|eval\(|Runtime\.evaluate|writeFile\(/);
});
test('preload and UI expose only named existence/uniqueness checks and clearly limit result to V1',()=>{
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(preload,/runDomContract:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:run-dom-contract'/);
 assert.match(ui,/双次 DOM 合约核验/);
 assert.match(ui,/runDomContract\(/);
 assert.match(ui,/唯一匹配/);
 assert.match(ui,/至少一个匹配/);
 assert.match(ui,/V3\/V4.*未配置/);
});

test('named DOM contracts retrieve author ShadowRoot context without claiming a top-document miss is final',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:run-dom-contract'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
 assert.match(handler,/summarize:captureDomSummary/);
 assert.match(handler,/confirm:confirmPageIdentity/);
});
