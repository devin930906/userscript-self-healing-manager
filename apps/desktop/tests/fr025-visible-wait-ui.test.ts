import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('FR-025 bounded visible wait reaches real selected Chrome through approved scoped Main IPC',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:wait-until-visible'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
 assert.ok(handler,'missing user-triggered wait-until-visible handler');
 for(const required of [
  /assertSender\(event\)/,/q\.approved!==true/,/scanSessions\.require\(q\.scanId\)/,
  /withinAuthorized\(item\.path\)/,/record\.runtimeRequired/,/record\.receiver!=='document'/,
  /getVerifiedChromeStatus\(/,/checkUserscriptPageScope\(/,/scope\.status!=='allowed'/,
  /runReadOnlyVisibilityWait\(/,/scanSessions\.assertCurrent\(scanSnapshot\)/,
  /confirm:confirmPageIdentity/,/includeNodeFingerprints:true/,
  /inspectReadOnlyElementVisibility\(/,
 ])assert.match(handler,required);
 assert.doesNotMatch(handler,/Runtime\.evaluate|Input\.dispatch|execute\(|writeFile\(/);
});

test('FR-025 preload/UI expose bounded wait, actual V1 result and never imply user script or V2 pass',()=>{
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(preload,/waitUntilElementVisible:.*ipcRenderer\.invoke\('usshm:wait-until-visible',input\)/);
 assert.match(ui,/await window\.ussm\.waitUntilElementVisible\(/);
 assert.match(ui,/等待 CSS 可能可见（V1，只读）/);
 assert.match(ui,/visible-v1/);
 assert.match(ui,/连续可见/);
 assert.match(ui,/V2 未验证/);
 assert.match(ui,/不能证明.*脚本/);
});
