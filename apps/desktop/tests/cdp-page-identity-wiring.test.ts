import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
test('desktop probes and suggested repairs check live frame identity on both sides of DOM inspection',()=>{
 const main=readFileSync(join(process.cwd(),'apps/desktop/src/main/index.ts'),'utf8');
 assert.match(main,/from '\.\.\/\.\.\/\.\.\/\.\.\/packages\/cdp-client\/src\/page-identity\.ts'/);
 const probes=main.split("ipcMain.handle('usshm:probe-locators'")[1]?.split("ipcMain.handle('usshm:suggest-repair'")[0]??'';
 const suggestions=main.split("ipcMain.handle('usshm:suggest-repair'")[1]?.split("ipcMain.handle('usshm:propose-repair'")[0]??'';
 for(const handler of [probes,suggestions]){
  assert.equal((handler.match(/await confirmPageIdentity\(selected\)/g)??[]).length,2,'each operation requires a before-and-after frame check');
 }
});
