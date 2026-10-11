import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('script detail renders bounded GM grant inventory without a fabricated V4 pass',async()=>{
 const ui=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(ui,/GM 权限静态清单/);
 assert.match(ui,/managerApiCalls/);
 assert.match(ui,/grantStatus/);
 assert.match(ui,/\.slice\(0,\s*30\)/,'large API call inventories must not lock up the renderer');
 assert.match(ui,/V4 未验证/,'static AST evidence never certifies real Tampermonkey runtime');
});
