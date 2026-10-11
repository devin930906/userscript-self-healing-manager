import assert from 'node:assert/strict';import {test} from 'node:test';import {readFile} from 'node:fs/promises';
test('Chrome CDP connection is user-triggered and exposed only through named IPC',async()=>{
 const a=await readFile('apps/desktop/src/main/index.ts','utf8');const b=await readFile('apps/desktop/src/preload/index.ts','utf8');const c=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(a,/usshm:pick-chrome/);assert.match(a,/usshm:launch-chrome/);assert.match(a,/usshm:cdp-status/);
 assert.match(b,/pickChrome/);assert.match(b,/launchChrome/);assert.match(b,/getCdpStatus/);
 assert.match(c,/选择 Chrome/);assert.match(c,/检查 CDP 连接/);assert.match(c,/未验证是否为已选择的 Chrome/);
});

test('separate isolated Chrome debug profile requires explicit user action in UI',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const renderer=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(main,/ipcMain\.handle\('usshm:launch-isolated-chrome'/);
 assert.match(main,/Chrome-CDP-Profile/);
 assert.match(preload,/launchIsolatedChrome:/);
 assert.match(renderer,/启动隔离调试 Chrome/);
 assert.match(renderer,/不会使用原有 Chrome 的登录状态/);
});

test('Chrome launch success text requires a completed verified CDP handshake',async()=>{
 const renderer=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 const start=renderer.split('async function startChrome()')[1]?.split('async function startIsolatedChrome()')[0]??'';
 const isolated=renderer.split('async function startIsolatedChrome()')[1]?.split('async function checkCdp()')[0]??'';
 assert.match(start,/await window\.ussm\.launchChrome\(\)/);
 assert.match(isolated,/await window\.ussm\.launchIsolatedChrome\(\)/);
 assert.match(start,/握手已验证/);
 assert.match(isolated,/握手已验证/);
 assert.doesNotMatch(start,/请点击检查 CDP 连接确认握手成功/);
});
