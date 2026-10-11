import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('main exposes an independently invoked read-only core recovery audit through an OS directory picker',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:verify-core-recovery'");
 const end=main.indexOf("ipcMain.handle('usshm:pick-files'",start);
 assert.ok(start>=0&&end>start,'offline audit IPC must be registered before filesystem import');
 const handler=main.slice(start,end);
 assert.match(handler,/assertSender\(event\)/);
 assert.match(handler,/dialog\.showOpenDialog\(mainWindow/);
 assert.match(handler,/openDirectory/);
 assert.match(handler,/verifyCoreRecoveryBundle\(\{snapshotDirectory:/);
 assert.match(handler,/picker\.canceled/);
 assert.doesNotMatch(handler,/\b(?:rm|unlink|rename|copyFile|writeFile|createCoreRecoveryBundle|migrateDatabase)\s*\(/);
 assert.doesNotMatch(handler,/\b(?:q|request|input)\s*:\s*[^\n]*path|Runtime\.evaluate/,
  'renderer cannot designate arbitrary backup files or run the userscript');
});

test('preload and Chinese GUI independently audit old core recovery bundles without restoring them',async()=>{
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(preload,/verifyCoreRecovery:\(\)=>ipcRenderer\.invoke\('usshm:verify-core-recovery'\)/);
 assert.match(ui,/verifyCoreRecovery:\(\)=>Promise<\{canceled:boolean;verified\?:boolean;files\?:number\}>/);
 assert.match(ui,/await window\.ussm\.verifyCoreRecovery\(\)/);
 assert.match(ui,/核验已有核心备份/);
 assert.match(ui,/只读|不覆盖/);
 assert.doesNotMatch(preload,/verifyCoreRecovery:[^\n]*input/);
});
