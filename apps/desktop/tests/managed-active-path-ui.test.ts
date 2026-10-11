import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('Electron main returns real current.user.js activation path separately from immutable revision archive',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 for(const [channel,next] of [
  ['usshm:apply-batch-repair','usshm:apply-batch-repair-guarded'],
  ['usshm:apply-batch-repair-guarded','usshm:apply-repair-guarded'],
  ['usshm:apply-repair-guarded','usshm:apply-repair'],
  ['usshm:apply-repair','usshm:verify-managed-dom'],
 ]){
  const first=main.indexOf("ipcMain.handle('"+channel+"'");
  const stop=main.indexOf("ipcMain.handle('"+next+"'",first);
  assert.ok(first>=0&&stop>first,'missing IPC '+channel);
  assert.match(main.slice(first,stop),/activePath:join\(dataRoot,'managed',(?:item|trusted)\.scriptId,'current\.user\.js'\)/,
   channel+' must name actual active file, not immutable archive');
 }
});
test('renderer displays actual active path and never labels a revision archive as current',async()=>{
 const app=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 for(const line of [
  'setManagedActive({hash:receipt.hash,activePath:receipt.activePath})',
  'setManagedActive({hash:evidence.appliedHash,activePath:evidence.activePath})',
  'setManagedActive({hash:r.hash,activePath:r.activePath})',
 ]){
  assert.ok(app.includes(line),line);
 }
 assert.match(app,/当前受管副本/);
});
