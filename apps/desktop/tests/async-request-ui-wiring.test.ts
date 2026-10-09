import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('batch request finalizer cannot clear the busy state of a newer batch',()=>{
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 const batch=ui.split('async function batchDiagnose()')[1]?.split('async function probePage()')[0]??'';
 assert.match(batch,/batchGeneration\.current\.begin\(\)/);
 assert.match(batch,/batchGeneration\.current\.isCurrent\(token\)/);
 assert.match(batch,/finally\s*\{gate\.cancel\(\);if\(batchPauseGate\.current===gate\)batchPauseGate\.current=null;if\(batchGeneration\.current\.isCurrent\(token\)\)/,
  'clean up the owned pause gate, but never clear a newer batch busy state');
 assert.doesNotMatch(batch,/finally\s*\{\s*setBatchRunning\(false\);setBusy\(false\)/);
});
test('changing scan or selected target revokes batch response and allows an immediate new batch',()=>{
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(ui,/batchGeneration\.current\.invalidate\(\)/);
 assert.match(ui,/setBatchRunning\(false\)/);
 assert.match(ui,/batchActive\.current/);
});
test('single-script page probes ignore late successes and errors after a selection change',()=>{
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 const probe=ui.split('async function probePage()')[1]?.split('async function suggestBulkRepairs')[0]??'';
 assert.match(probe,/probeGeneration\.current\.begin\(\)/);
 assert.match(probe,/probeGeneration\.current\.isCurrent\(token\)/);
 assert.match(probe,/finally\s*\{\s*if\s*\(probeGeneration\.current\.isCurrent\(token\)\)/);
});
test('bulk candidate UI does not reset global busy after stale response',()=>{
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 const bulk=ui.split('async function suggestBulkRepairs')[1]?.split('async function suggestRepair()')[0]??'';
 assert.match(bulk,/bulkGeneration\.current\.begin\(\)/);
 assert.match(bulk,/finally\s*\{\s*if\s*\(bulkGeneration\.current\.isCurrent\(token\)\)/);
});
