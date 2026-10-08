import assert from 'node:assert/strict';import {test} from 'node:test';import {readFile} from 'node:fs/promises';
test('Chrome CDP connection is user-triggered and exposed only through named IPC',async()=>{
 const a=await readFile('apps/desktop/src/main/index.ts','utf8');const b=await readFile('apps/desktop/src/preload/index.ts','utf8');const c=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(a,/usshm:pick-chrome/);assert.match(a,/usshm:launch-chrome/);assert.match(a,/usshm:cdp-status/);
 assert.match(b,/pickChrome/);assert.match(b,/launchChrome/);assert.match(b,/getCdpStatus/);
 assert.match(c,/选择 Chrome/);assert.match(c,/检查 CDP 连接/);assert.match(c,/未验证是否为已选择的 Chrome/);
});
