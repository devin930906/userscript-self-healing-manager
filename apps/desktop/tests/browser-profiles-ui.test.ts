import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
test('FR-002 browser profiles are managed exclusively by Main and chosen with explicit native actions',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 for(const handler of ['usshm:list-browser-profiles','usshm:create-browser-profile',
  'usshm:rename-browser-profile','usshm:default-browser-profile',
  'usshm:remove-browser-profile','usshm:launch-browser-profile']){
  assert.ok(main.includes("ipcMain.handle('"+handler+"'"),handler+' main handler missing');
  assert.ok(preload.includes("ipcRenderer.invoke('"+handler+"'"),handler+' preload method missing');
 }
 assert.match(ui,/保存浏览器配置/);
 assert.match(ui,/启动选定配置/);
 assert.match(ui,/设为默认/);
 assert.match(ui,/删除配置记录/);
 assert.match(main,/resolveBrowserProfileForLaunch/);
 assert.match(main,/ensureWritableDataRoot\(isolatedProfileDir\)/);
});
test('renderer cannot dictate arbitrary Chrome EXE or profile directory through browser profile IPC',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:create-browser-profile'")[1]?.split("ipcMain.handle('usshm:rename-browser-profile'")[0]??'';
 assert.match(handler,/approvedChromePath/);
 assert.match(handler,/createBrowserProfile/);
 assert.doesNotMatch(handler,/q\.executablePath|q\.profileDir|q\.dataRoot/);
 assert.doesNotMatch(preload,/createBrowserProfile:.*executablePath/);
});
