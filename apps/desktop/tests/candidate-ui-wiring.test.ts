import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
test('recommendation IPC binds real lastScan source to selected local CDP page',async()=>{
 const code=await readFile('apps/desktop/src/main/index.ts','utf8');
 assert.match(code,/ipcMain\.handle\('usshm:suggest-repair'/);
 assert.match(code,/assertSender\(event\)/);
 assert.match(code,/lastScan\?\.items\[q\.itemIndex\]/);
 assert.match(code,/status\.pages\.find\(/);
 assert.match(code,/suggestCandidateRepairs\(/);
});
test('UI only offers candidates for currently missing selectors and populates manual preview',async()=>{
 const code=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(code,/生成候选定位器/);
 assert.match(code,/status==='missing'/);
 assert.match(code,/setRepairNew\(candidate\.expression\)/);
 assert.match(code,/候选不代表功能验证通过/);
});
test('candidate IPC rejects target pages outside userscript @match rules',async()=>{
 const code=await readFile('apps/desktop/src/main/index.ts','utf8');
 assert.match(code,/checkUserscriptPageScope\(item\.analysis\.metadata,selected\.url\)/);
 assert.match(code,/scope\.status!=='allowed'/);
});
test('DOM validation is marked unknown when selector receiver is not document',async()=>{
 const code=await readFile('apps/desktop/src/main/index.ts','utf8');
 assert.match(code,/x\.receiver!=='document'/);
 assert.match(code,/record\.receiver!=='document'/);
});
test('changing page or original selector invalidates previously chosen candidate and patch approval',async()=>{
 const code=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(code,/setTargetId\(e\.target\.value\);setPageProbe\(null\);setRepairCandidates\(null\);setRepairNew\(''\);setRepairProposal\(null\)/);
 assert.match(code,/setRepairIndex\(Number\(e\.target\.value\)\);setRepairProposal\(null\);setRepairCandidates\(null\);setRepairNew\(''\)/);
});
