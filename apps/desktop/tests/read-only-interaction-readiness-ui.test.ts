import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('Main readiness IPC enforces native sender, scanned script authorization, strict page scope and document recheck',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:read-only-interaction-readiness'");
 const end=main.indexOf("ipcMain.handle('usshm:run-dom-contract'",start);
 assert.ok(start>=0&&end>start,'named readiness handler must precede V1 contract handler');
 const handler=main.slice(start,end);
 for(const required of [
  /assertSender\(event\)/,/q\.approved!==true/,/scanSessions\.require\(/,
  /withinAuthorized\(item\.path\)/,/record\.runtimeRequired/,/record\.receiver!=='document'/,
  /getVerifiedChromeStatus\(/,/checkUserscriptPageScope\(/,/scope\.status!=='allowed'/,
  /runReadOnlyInteractionReadiness\(/,/scanSessions\.assertCurrent\(/,
  /confirmPageIdentity/,/includeNodeFingerprints:true/,
 ]){
  assert.match(handler,required);
 }
 assert.doesNotMatch(handler,/Runtime\.evaluate|Input\.dispatchMouseEvent|\.click\(|eval\(/);
});

test('preload bridge and GUI expose clearly bounded V2 readiness hints but no click or V3/V4 success',async()=>{
 const pre=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(pre,/inspectInteractionReadiness:.*ipcRenderer\.invoke\('usshm:read-only-interaction-readiness',input\)/);
 assert.match(ui,/await window\.ussm\.inspectInteractionReadiness\(/);
 assert.match(ui,/双次交互条件评估（只读）/);
 assert.match(ui,/V2 未验证/);
 assert.match(ui,/potentially-ready/);
});
