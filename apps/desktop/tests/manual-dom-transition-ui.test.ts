import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('FR-025 two-stage desktop action goes through sender/scope/document consent gates without browser mutation',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const body=main.split("ipcMain.handle('usshm:manual-dom-transition'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
 assert.ok(body,'missing desktop manual DOM transition handler');
 for(const required of [
  /assertSender\(event\)/,/q\.approved!==true/,
  /scanSessions\.require\(q\.scanId\)/,/withinAuthorized\(item\.path\)/,
  /record\.runtimeRequired/,/record\.receiver!=='document'/,
  /getVerifiedChromeStatus\(/,/checkUserscriptPageScope\(/,
  /scope\.status!=='allowed'/,/confirmPageIdentity\(/,
  /runReadOnlyDomContract\(/,/assertStablePageDocument\(/,
  /manualTransitions\.assertPending\(/,/manualTransitions\.begin\(/,
  /manualTransitions\.finish\(/,/scanSessions\.assertCurrent\(scanSnapshot\)/,
 ])assert.match(body,required);
 assert.doesNotMatch(body,/Input\.dispatch|Runtime\.evaluate|DOM\.focus|writeFile\(|deleteFile\(/);
});

test('FR-025 desktop renders two user-paced observation steps, revokes old result on changed context and warns about V2/V3',async()=>{
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(preload,/observeManualDomTransition:.*ipcRenderer\.invoke\('usshm:manual-dom-transition',input\)/);
 assert.match(ui,/await window\.ussm\.observeManualDomTransition\(/);
 assert.match(ui,/记录手动操作前 DOM 状态/);
 assert.match(ui,/复核手动操作后 DOM 状态/);
 assert.match(ui,/V2 未验证/);
 assert.match(ui,/不会.*自动.*点击|没有.*点击.*网页/);
 assert.match(ui,/manualTransitionGeneration\.current\.invalidate\(\)/);
});
