import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const main=()=>readFile('apps/desktop/src/main/index.ts','utf8');
const preload=()=>readFile('apps/desktop/src/preload/index.ts','utf8');
const ui=()=>readFile('apps/desktop/src/renderer/App.tsx','utf8');
test('only approved imported script and selected CDP target can be probed',async()=>{
 const file=await main();
 assert.match(file,/ipcMain\.handle\('usshm:probe-locators'/);
 assert.match(file,/captureDomSummary\(/);
 assert.match(file,/probePageLocators\(/);
 assert.match(file,/scanSnapshot\?\.items\[/);
 assert.match(file,/approved:true/);
});
test('preload only exposes a narrow locator command',async()=>{assert.match(await preload(),/probeLocators:/);});
test('UI displays evidence counts and explicit limitations',async()=>{
 const source=await ui();
 assert.match(source,/页面定位器核验/);
 assert.match(source,/不代表油猴脚本功能通过/);
 assert.match(source,/DOM 文档节点/);
});
test('switching inspected scripts clears stale DOM evidence',async()=>{
 assert.match(await ui(),/setFocused\(item\.index\);setPageProbe\(null\)/);
});
