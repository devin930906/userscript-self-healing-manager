import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('FR-025 product action review is reachable from trusted desktop for an authorized script/target',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const chunk=main.split("ipcMain.handle('usshm:product-action-review'")[1]?.split("ipcMain.handle('usshm:")[0]??'';
 assert.ok(chunk,'missing production review handler');
 for(const pattern of [
  /assertSender\(event\)/,/q\.approved!==true/,
  /scanSessions\.require\(q\.scanId\)/,/withinAuthorized\(item\.path\)/,
  /record\.runtimeRequired/,/record\.receiver!=='document'/,
  /getVerifiedChromeStatus\(/,/checkUserscriptPageScope\(/,
  /scope\.status!=='allowed'/,/runReadOnlyInteractionReadiness\(/,
  /reviewProductAction\(/,/scanSessions\.assertCurrent\(scanSnapshot\)/,
 ])assert.match(chunk,pattern);
 assert.doesNotMatch(chunk,/Input\.dispatch|Runtime\.evaluate|DOM\.focus|writeFile\(|execute\(/);
});

test('FR-025 action review is an actual typed preload/UI workflow with user-selected risk and no execute action',()=>{
 const preload=readFileSync('apps/desktop/src/preload/index.ts','utf8');
 const renderer=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(preload,/reviewProductAction:.*ipcRenderer\.invoke\('usshm:product-action-review',input\)/);
 assert.match(renderer,/await window\.ussm\.reviewProductAction\(/);
 assert.match(renderer,/动作风险审查（只读）/);
 assert.match(renderer,/STATE_CHANGING|DESTRUCTIVE/);
 assert.match(renderer,/不会自动执行|不执行网页操作/);
 assert.match(renderer,/productActionGeneration\.current\.invalidate\(\)/);
 assert.doesNotMatch(preload,/dispatchMouseEvent|executeAction/);
});
