import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyProductionBundles} from '../../scripts/production-boundary.mjs';

test('production boundary fails closed for computed and optional CDP execution methods', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ussm-production-boundary-'));
 try {
  for (const name of ['main.cjs', 'preload.cjs', 'renderer.js'])
   await writeFile(join(dir, name), 'const safe = true;');
  for (const expression of [
   'Runtime["evaluate"]({expression:"1"})',
   "Runtime['evaluate']({expression:'1'})",
   'Runtime?.evaluate({expression:"1"})',
   'Runtime?.["evaluate"]({expression:"1"})',
   'Input["dispatchMouseEvent"]({})',
   "Input?.['dispatchMouseEvent']({})",
  ]) {
   await writeFile(join(dir, 'renderer.js'), expression);
   await assert.rejects(verifyProductionBundles(dir), /Test-only CDP execution capability/);
  }
  await writeFile(join(dir, 'renderer.js'), 'const safe = true;');
  assert.deepEqual(await verifyProductionBundles(dir), {valid:true, checkedFiles:3});
 } finally {
  await rm(dir, {recursive:true, force:true});
 }
});
