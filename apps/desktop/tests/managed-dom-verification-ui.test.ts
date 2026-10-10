import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('post-repair V1 UI calls a dedicated read-only managed revision verifier, not original scanned selector',async()=>{
 const renderer=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 assert.match(preload,/verifyManagedDom:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:verify-managed-dom',input\)/);
 assert.match(renderer,/async function verifyManagedDom\(/);
 assert.match(renderer,/window\.ussm\.verifyManagedDom\(/);
 assert.match(renderer,/只读复核受管修订 V1/);
 assert.match(renderer,/V2\/V3\/V4 未验证/);
});
test('post-repair verifier selects the current immutable managed AST and a two-sample DOM contract',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:verify-managed-dom'");
 const end=main.indexOf("ipcMain.handle('usshm:managed-revisions'",start);
 assert.ok(start>0&&end>start);
 const handler=main.slice(start,end);
 assert.match(handler,/q\.approved!==true/);
 assert.match(handler,/scanSessions\.require\(q\.scanId\)/);
 assert.match(handler,/checkUserscriptPageScope\(item\.analysis\.metadata,selected\.url\)/);
 assert.match(handler,/readVerifiedManagedLocator\(/);
 assert.match(handler,/runReadOnlyDomContract\(/);
 assert.match(handler,/includeNodeFingerprints:true/);
 assert.match(handler,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.doesNotMatch(handler,/Input\.dispatchMouseEvent|Runtime\.evaluate|executeJavaScript/);
});
