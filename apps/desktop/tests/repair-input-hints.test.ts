import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {getRepairInputHint} from '../src/renderer/repair-hints.ts';

test('repair input helps users distinguish raw IDs, name/class arguments and CSS selectors',()=>{
 assert.match(getRepairInputHint('getElementById'),/不要加\s*#/);
 assert.match(getRepairInputHint('getElementsByName'),/name/);
 assert.match(getRepairInputHint('getElementsByClassName'),/空格/);
 assert.match(getRepairInputHint('querySelector'),/data-testid/);
 assert.match(getRepairInputHint('closest'),/data-testid/);
});

test('repair GUI derives argument hint from the actual selected DOM method',async()=>{
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(ui,/getRepairInputHint\(details\.analysis\?\.selectorRecords\[repairIndex\]\?\.method\)/);
 assert.match(ui,/新的方法参数/);
});
