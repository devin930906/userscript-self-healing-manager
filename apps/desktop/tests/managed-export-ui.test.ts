import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
test('managed export only accepts selected script index and native Save dialog destination',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const renderer=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 const handler=main.split("ipcMain.handle('usshm:export-managed'")[1]?.split("ipcMain.handle('usshm:rollback-managed'")[0]??'';
 assert.match(handler,/assertSender\(event\)/);
 assert.match(handler,/dialog\.showSaveDialog/);
 assert.match(handler,/withinAuthorized\(item\.path\)/);
 assert.match(handler,/exportManagedCurrent/);
 assert.doesNotMatch(handler,/q\.destinationPath|q\.path|writeFile\(/);
 assert.match(preload,/exportManaged:\(input:\{scanId:string;itemIndex:number\}\)=>ipcRenderer\.invoke\('usshm:export-managed'/);
 assert.match(renderer,/安全导出 \.user\.js/);
 assert.match(renderer,/window\.ussm\.exportManaged\(\{scanId:result\.scanId,itemIndex:focused\}\)/);
});
