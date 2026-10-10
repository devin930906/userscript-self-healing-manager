import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('offline recovery staging requires main-frame IPC, two OS directory choices and native confirmation',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:stage-core-recovery'");
 const end=main.indexOf("ipcMain.handle('usshm:pick-files'",start);
 assert.ok(start>=0&&end>start);
 const handler=main.slice(start,end);
 assert.match(handler,/assertSender\(event\)/);
 assert.match(handler,/dialog\.showOpenDialog\(mainWindow/g);
 assert.match(handler,/dialog\.showMessageBox\(mainWindow/);
 assert.match(handler,/stageCoreRecoveryForOfflineReview\(\{\s*snapshotDirectory:/);
 assert.match(handler,/activeDataRoot:dataRoot/);
 assert.match(handler,/randomUUID\(\)/);
 assert.doesNotMatch(handler,/\b(?:rm|unlink|migrateDatabase|rename|deleteFile)\s*\(/);
});
test('offline recovery staging renderer has no arbitrary filesystem or data overwrite API',async()=>{
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(preload,/stageCoreRecovery:\(\)=>ipcRenderer\.invoke\('usshm:stage-core-recovery'\)/);
 assert.match(ui,/stageCoreRecovery:\(\)=>Promise<\{canceled:boolean;/);
 assert.match(ui,/await window\.ussm\.stageCoreRecovery\(\)/);
 assert.match(ui,/离线暂存核心备份/);
 assert.match(ui,/没有自动启用|不会自动启用/);
 assert.doesNotMatch(preload,/stageCoreRecovery:[^\n]*input/);
});
