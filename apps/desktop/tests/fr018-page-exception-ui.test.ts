import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('FR-018 desktop Main grants only named, consented page exception counts on a verified Chrome target',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:read-only-page-exceptions'")[1]
  ?.split("ipcMain.handle('usshm:probe-locators'")[0]??'';
 assert.ok(handler,'desktop Main must expose one explicit named operation');
 assert.match(handler,/assertSender\(event\)/);
 assert.match(handler,/approved!==true/);
 assert.match(handler,/targetId/);
 assert.match(handler,/getVerifiedChromeStatus\(\{port:9223\}\)/);
 assert.match(handler,/webSocketDebuggerUrl/);
 assert.match(handler,/observeReadOnlyPageExceptions/);
 assert.match(handler,/approved:true/);
 assert.doesNotMatch(handler,/Runtime\.evaluate|Input\.dispatch|executeJavaScript|\.get\(.*url|http\.(?:get|post)/);
});

test('FR-018 preload exposes no generic CDP commands or arbitrary exception text',async()=>{
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 assert.match(preload,/observePageExceptions:\(input:\{targetId:string;approved:true\}\)/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:read-only-page-exceptions',input\)/);
 assert.doesNotMatch(preload,/sendRawCdpCommand|readExceptionStack|Runtime\.evaluate/);
});

test('FR-018 renderer requires a selected page, revokes stale output and labels evidence inconclusive',async()=>{
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(ui,/PassivePageExceptionEvidence/);
 assert.match(ui,/exceptionGeneration\.current\.invalidate\(\)/);
 assert.match(ui,/\[targetId,cdp,chromePath\]/);
 assert.match(ui,/window\.ussm\.observePageExceptions\(\{targetId:target,approved:true\}\)/);
 assert.match(ui,/exceptionGeneration\.current\.isCurrent\(token\)/);
 assert.match(ui,/disabled=\{[^}]*!targetId/);
 assert.match(ui,/观察网页异常（只计数）/);
 assert.match(ui,/不能证明异常来自油猴脚本/);
 assert.match(ui,/V3\/V4 未验证/);
 assert.doesNotMatch(ui,/exception\.stack|exception\.message|Runtime\.evaluate/);
});
