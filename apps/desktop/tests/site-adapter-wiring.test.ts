import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('SiteAdapter import preview originates only in Electron native OS JSON file picker',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:site-adapter-import-preview'")[1]?.split("ipcMain.handle('usshm:site-adapter-import-approve'")[0]??'';
 assert.match(main,/createSiteAdapterLibrary\(\{dataRoot\}\)/);
 assert.match(handler,/assertSender\(event\)/);
 assert.match(handler,/dialog\.showOpenDialog\(mainWindow/);
 assert.match(handler,/extensions:\['json'\]/);
 assert.match(handler,/adapters\.previewImport\(\{sourcePath:.*filePaths\[0\]/);
 assert.doesNotMatch(handler,/input.*path|q\.sourcePath/);
});
test('SiteAdapter approval is a separate IPC action with explicit consent and opaque preview ID',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:site-adapter-import-approve'")[1]?.split("ipcMain.handle('usshm:pick-chrome'")[0]??'';
 assert.match(handler,/assertSender\(event\)/);
 assert.match(handler,/approved!==true/);
 assert.match(handler,/adapters\.approveImport\(\{previewId:/);
 assert.doesNotMatch(handler,/sourcePath|newSelector|\.eval\(/);
});
test('SiteAdapter preload uses named operations and UI separates preview from commit',async()=>{
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(preload,/listSiteAdapters:/);
 assert.match(preload,/previewSiteAdapterImport:/);
 assert.match(preload,/approveSiteAdapterImport:/);
 assert.match(ui,/版本化站点兼容规则/);
 assert.match(ui,/预览 SiteAdapter JSON/);
 assert.match(ui,/确认导入此规则/);
 assert.match(ui,/未经过真实脚本运行或功能验证/);
 assert.match(ui,/window\.ussm\.listSiteAdapters\(\)/);
 assert.match(ui,/window\.ussm\.previewSiteAdapterImport\(\)/);
 assert.match(ui,/window\.ussm\.approveSiteAdapterImport\(/);
});

test('SiteAdapter preview cancellation has a narrow main IPC route and a real UI action',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(main,/ipcMain\.handle\('usshm:site-adapter-import-discard'/);
 assert.match(main,/adapters\.discardPreview\(/);
 assert.match(preload,/discardSiteAdapterPreview:/);
 assert.match(ui,/window\.ussm\.discardSiteAdapterPreview\(/);
 assert.match(ui,/取消预览/);
});
