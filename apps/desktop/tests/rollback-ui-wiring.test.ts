import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const main=()=>readFile('apps/desktop/src/main/index.ts','utf8');
const preload=()=>readFile('apps/desktop/src/preload/index.ts','utf8');
const gui=()=>readFile('apps/desktop/src/renderer/App.tsx','utf8');
test('rollback IPC binds revisions to authorized scanned script rather than arbitrary path',async()=>{
 const s=await main();
 assert.match(s,/ipcMain\.handle\('usshm:managed-revisions'/);
 assert.match(s,/ipcMain\.handle\('usshm:rollback-managed'/);
 assert.match(s,/lastScan\?\.items\[q\.itemIndex\]/);
 assert.match(s,/withinAuthorized\(item\.path\)/);
 assert.match(s,/activateManagedRevision\(/);
});
test('preload exposes only named revision and approval operations',async()=>{
 const s=await preload();
 assert.match(s,/listManagedRevisions:/);
 assert.match(s,/rollbackManaged:/);
 assert.ok(!s.includes('writeFile('));
});
test('GUI requires deliberate restore action and disclaims overriding the original',async()=>{
 const s=await gui();
 assert.match(s,/查看受管历史/);
 assert.match(s,/恢复此受管副本/);
 assert.match(s,/原始脚本不会被覆盖/);
 assert.match(s,/listManagedRevisions\(/);
 assert.match(s,/rollbackManaged\(/);
});
