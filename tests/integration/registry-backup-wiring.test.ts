import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('registry WAL backup is available only through native Save dialog and trusted Main IPC',async()=>{
 const main=await readFile(new URL('../../apps/desktop/src/main/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../../apps/desktop/src/preload/index.ts',import.meta.url),'utf8');
 const renderer=await readFile(new URL('../../apps/desktop/src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(main,/import\s*\{[^}]*backupRegistryDatabase[^}]*\}\s*from\s*['"][^'"]*persistence\/src\/index\.ts/);
 assert.match(main,/ipcMain\.handle\('usshm:backup-registry',async\s+event\s*=>\s*\{\s*assertSender\(event\)/);
 assert.match(main,/dialog\.showSaveDialog\(mainWindow/);
 assert.match(main,/backupRegistryDatabase\(db,save\.filePath\)/);
 assert.match(preload,/backupRegistry:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('usshm:backup-registry'\)/);
 assert.match(renderer,/window\.ussm\.backupRegistry\(\)/);
 assert.match(renderer,/SQLite.*备份|备份.*SQLite/);
 assert.match(renderer,/不包含.*(受管修订|诊断历史)|仅备份.*SQLite/);
});


test('diagnosis history online backup uses a trusted native save dialog without renderer-controlled paths',async()=>{
 const main=await readFile(new URL('../../apps/desktop/src/main/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../../apps/desktop/src/preload/index.ts',import.meta.url),'utf8');
 const renderer=await readFile(new URL('../../apps/desktop/src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(main,/ipcMain\.handle\('usshm:backup-journal',async event=>\{\s*assertSender\(event\)/);
 assert.match(main,/journal\.backupSnapshot\(save\.filePath\)/);
 assert.match(preload,/backupJournal:\(\)=>ipcRenderer\.invoke\('usshm:backup-journal'\)/);
 assert.match(renderer,/window\.ussm\.backupJournal\(\)/);
 assert.match(renderer,/诊断历史.*备份/);
 assert.match(renderer,/不包含.*受管修订|仅备份.*诊断历史/);
});
