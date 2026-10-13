import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('RG-06 desktop offline stage audit trusts two native OS directory choices, not renderer path strings',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:verify-offline-core-stage'");
 const end=main.indexOf("ipcMain.handle('usshm:stage-core-recovery'",start);
 assert.ok(start>=0&&end>start,'main must expose a distinct read-only audit IPC handler');
 const handler=main.slice(start,end);
 assert.match(handler,/assertSender\(event\)/);
 assert.equal((handler.match(/dialog\.showOpenDialog\(mainWindow/g)??[]).length,2,
  'each of source and stage must be selected by the operating system');
 assert.match(handler,/verifyCoreOfflineRecoveryStage\(\{\s*snapshotDirectory:/);
 assert.match(handler,/stagedDirectory:/);
 assert.match(handler,/return \{canceled:false,verified:/);
 assert.doesNotMatch(handler,/\b(?:rm|unlink|rename|stageCoreRecoveryForOfflineReview|migrateDatabase|createCoreRecoveryBundle)\s*\(/,
  'offline audit must not write, stage, restore or activate');
});

test('RG-06 desktop renderer may invoke offline audit without supplying arbitrary filesystem paths',async()=>{
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(preload,/verifyOfflineCoreStage:\(\)=>ipcRenderer\.invoke\('usshm:verify-offline-core-stage'\)/);
 assert.doesNotMatch(preload,/verifyOfflineCoreStage:[^\n]*input/);
 assert.match(ui,/verifyOfflineCoreStage:\(\)=>Promise<\{canceled:boolean;/);
 assert.match(ui,/await window\.ussm\.verifyOfflineCoreStage\(\)/);
 assert.match(ui,/onClick=\{\(\)=>void verifyOfflineCoreStage\(\)\}/);
 assert.match(ui,/核验离线暂存|离线暂存核验/);
 assert.match(ui,/没有自动恢复|不会自动恢复|不会自动启用/);
});
