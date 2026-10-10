import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('Main owns verified candidate discovery, source hash, site scope and approval registration',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:prepare-verified-preview'");
 const end=main.indexOf("ipcMain.handle('usshm:propose-repair'",start);
 assert.ok(start>=0&&end>start);
 const handler=main.slice(start,end);
 assert.match(handler,/q\.approved!==true/);
 assert.match(handler,/scanSessions\.require\(q\.scanId\)/);
 assert.match(handler,/withinAuthorized\(item\.path\)/);
 assert.match(handler,/record\.receiver!=='document'/);
 assert.match(handler,/checkUserscriptPageScope\(item\.analysis\.metadata,selected\.url\)/);
 assert.match(handler,/readPinnedRegularFile\(item\.path,\{maxBytes:512\*1024,expected:sourceInfo\}\)/);
 assert.match(handler,/suggestCandidateRepairs\(/);
 assert.match(handler,/prepareVerifiedRepairPreview\(/);
 assert.match(handler,/pendingApprovals\.register\(receipt\.proposal\.proposalId,scanSnapshot\.scanId\)/);
 assert.doesNotMatch(handler,/q\.newSelector|eval\(|executeJavaScript|Input\.dispatchMouseEvent/,
  'renderer must not supply arbitrary candidates, execute scripts, or click websites');
});

test('preload and UI expose an explicit preview-only action, not silent managed apply',async()=>{
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(preload,/prepareVerifiedPreview:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:prepare-verified-preview'/);
 assert.match(ui,/async function prepareVerifiedPreview\(/);
 assert.match(ui,/\.ussm\.prepareVerifiedPreview\(/);
 assert.match(ui,/自动准备唯一候选的受管修复预览/);
 assert.match(ui,/仍需单独审核保存/);
});
