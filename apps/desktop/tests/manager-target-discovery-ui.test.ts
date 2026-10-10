import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('manager target observation travels through consent-gated Electron Main and the narrow Preload bridge',async()=>{
 const [main,preload,ui]=await Promise.all([
  readFile('apps/desktop/src/main/index.ts','utf8'),
  readFile('apps/desktop/src/preload/index.ts','utf8'),
  readFile('apps/desktop/src/renderer/App.tsx','utf8'),
 ]);
 assert.match(main,/ipcMain\.handle\('usshm:manager-targets'/);
 const start=main.indexOf("ipcMain.handle('usshm:manager-targets'");
 assert.ok(start>0);
 const body=main.slice(start,start+1100);
 assert.match(body,/assertSender\(event\)/);
 assert.match(body,/approved!==true/);
 assert.match(body,/getVerifiedChromeStatus\(\{port:9223\}\)/);
 assert.match(body,/inspectKnownUserscriptManagerTargets/);
 assert.match(preload,/getManagerTargets:\s*\(input:\{approved:true\}\)=>ipcRenderer\.invoke\('usshm:manager-targets',input\)/);
 assert.match(ui,/window\.ussm\.getManagerTargets\(\{approved:true\}\)/);
 assert.match(ui,/扩展运行目标|扩展目标/);
 assert.match(ui,/V4.*未验证|V4.*未配置/);
});

test('changing Chrome identity revokes any in-flight manager observation instead of displaying stale V4 hints',async()=>{
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(ui,/managerTargetGeneration=useRef\(new LatestRequestGate\(\)\)/);
 assert.match(ui,/managerTargetGeneration\.current\.invalidate\(\);setManagerTargetReport\(null\)/);
 assert.match(ui,/\[cdp,chromePath\]/);
 assert.match(ui,/managerTargetGeneration\.current\.begin\(\)/);
 assert.match(ui,/managerTargetGeneration\.current\.commit\(token,\(\)=>setManagerTargetReport\(observed\)\)/);
 assert.match(ui,/setManagerBusy\(false\)/);
 assert.match(ui,/disabled=\{!cdp\|\|busy\|\|managerBusy\}/);
});
