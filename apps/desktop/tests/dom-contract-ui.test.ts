import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('Electron DOM contract IPC binds only a scanned document locator, explicit target and user consent',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:run-dom-contract'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
 assert.match(main,/ipcMain\.handle\('usshm:run-dom-contract'/);
 assert.match(handler,/assertSender\(event\)/);
 assert.match(handler,/q\.approved!==true/);
 assert.match(handler,/scanSessions\.require\(q\.scanId\)/);
 assert.match(handler,/selectorRecords\[q\.selectorIndex\]/);
 assert.match(handler,/receiver!=='document'/);
 assert.match(handler,/checkUserscriptPageScope\(/);
 assert.match(handler,/runReadOnlyDomContract\(/);
 assert.match(handler,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.doesNotMatch(handler,/q\.locator\b|eval\(|Runtime\.evaluate|writeFile\(/);
});
test('preload and UI expose only named existence/uniqueness checks and clearly limit result to V1',()=>{
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(preload,/runDomContract:/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:run-dom-contract'/);
 assert.match(ui,/双次 DOM 合约核验/);
 assert.match(ui,/runDomContract\(/);
 assert.match(ui,/唯一匹配/);
 assert.match(ui,/至少一个匹配/);
 assert.match(ui,/V3\/V4.*未配置/);
});

test('named DOM contracts retrieve author ShadowRoot context without claiming a top-document miss is final',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:run-dom-contract'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
 assert.match(handler,/summarize:captureDomSummary/);
 assert.match(handler,/confirm:confirmPageIdentity/);
});


test('FR-025 named count-change contract crosses Main IPC, preload types and renderer without V3/V4 promotion',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const renderer=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 const handler=main.split("ipcMain.handle('usshm:run-dom-contract'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
 assert.match(handler,/expectation:'exists'\|'unique'\|'count-changed'/,
  'Main validates the only 3 supported named read-only contracts');
 assert.match(handler,/q\.expectation!=='count-changed'/,
  'Main rejects unknown requested expectations before CDP or script data access');
 assert.match(preload,/expectation:'exists'\|'unique'\|'count-changed'/);
 assert.match(renderer,/expectation:'exists'\|'unique'\|'count-changed'/);
 assert.match(renderer,/useState<'exists'\|'unique'\|'count-changed'>/);
 assert.match(renderer,/<option value="count-changed">DOM 匹配数量变化（V1，只读）<\/option>/);
 assert.match(renderer,/V2 未验证，V3\/V4：未配置/);
 assert.match(handler,/approved:true,target:selected/);
 assert.match(handler,/confirm:confirmPageIdentity/);
 assert.match(handler,/probePageLocators\(page,locators,\{includeNodeFingerprints:true\}\)/);
 assert.doesNotMatch(handler,/Runtime\.evaluate|writeFile\(|execute\(/);
});


test('FR-025 switching the DOM expectation synchronously revokes in-flight V1 evidence and frees the old request slot',()=>{
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 const selector=ui.split('<label>DOM 合约预期<select')[1]?.split('</select>')[0]??'';
 assert.ok(selector,'named DOM expectation control must be available');
 assert.match(selector,/onChange=\{e=>\{/);
 assert.match(selector,/contractGeneration\.current\.invalidate\(\)/,
  'late response cannot overwrite the newly selected named DOM contract');
 assert.match(selector,/if\(contractActive\.current\)\{contractActive\.current=false;setBusy\(false\);\}/,
  'a revoked old V1 observation must not leave the UI stuck busy');
 assert.match(selector,/setContractExpectation\(/);
 assert.match(selector,/setContractEvidence\(null\)/);
 const flow=ui.split('async function runDomContract()')[1]?.split('async function suggestBulkRepairs')[0]??'';
 assert.match(flow,/contractGeneration\.current\.isCurrent\(token\)/);
 assert.match(flow,/finally\s*\{\s*if\(contractGeneration\.current\.isCurrent\(token\)\)/,
  'late request cleanup must not clear a newer in-flight validation');
});
