import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const main='apps/desktop/src/main/index.ts';const preload='apps/desktop/src/preload/index.ts';
test('Electron BrowserWindow must not expose NodeJS or unsafe navigation to web content',async()=>{
 const s=await readFile(main,'utf8');
 assert.match(s,/nodeIntegration:\s*false/);assert.match(s,/contextIsolation:\s*true/);assert.match(s,/sandbox:\s*true/);
 assert.match(s,/setWindowOpenHandler/);assert.match(s,/will-navigate/);
});
test('preload exposes a constrained API without generic ipcRenderer access',async()=>{
 const s=await readFile(preload,'utf8');
 assert.match(s,/contextBridge\.exposeInMainWorld/);assert.doesNotMatch(s,/exposeInMainWorld\([^,]+,\s*ipcRenderer/);
 assert.match(s,/pickFiles/);assert.match(s,/scan/);assert.match(s,/listScripts/);
});
test('IPC must reject messages sent from subframes, not only top-level webContents',async()=>{
 const s=await readFile(main,'utf8');
 assert.match(s,/event\.senderFrame\s*!==\s*mainWindow\.webContents\.mainFrame/);
});
test('CDP status IPC returns only passive display metadata, not debugger bearer URLs',async()=>{
 const s=await readFile(main,'utf8');
 assert.match(s,/return\s*\{\s*browser:\s*status\.browser/);
 assert.match(s,/pages:\s*status\.pages\.map/);
 assert.doesNotMatch(s,/return\s+getChromeStatus\(/);
});
