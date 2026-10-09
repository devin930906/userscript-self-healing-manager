import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
test('DOM batch export is explicitly requested, tied to the active scan and never writes a renderer-supplied path',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(main,/ipcMain\.handle\('usshm:export-dom-report'/);
 assert.match(main,/scanSessions\.require\(q\.scanId\)/);
 assert.match(main,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.match(main,/serializeDomBatchReport\(/);
 assert.match(main,/dialog\.showSaveDialog/);
 assert.match(preload,/exportDomReport:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:export-dom-report'/);
 assert.match(ui,/导出 DOM JSON/);
 assert.match(ui,/导出 DOM Markdown/);
 assert.match(ui,/ussm\.exportDomReport/);
});
