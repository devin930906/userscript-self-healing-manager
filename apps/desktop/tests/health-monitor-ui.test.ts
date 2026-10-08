import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
test('local health watch is opted into, stoppable and read-only',async()=>{
 const app=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(app,/启动每分钟只读巡检/);
 assert.match(app,/停止巡检/);
 assert.match(app,/setInterval/);
 assert.match(app,/clearInterval/);
 assert.match(app,/setWatchEnabled\(false\)/);
 assert.match(app,/ussm\.probeLocators/);
 assert.match(app,/巡检只用于 DOM 检测，不代表 Tampermonkey 功能通过/);
});
