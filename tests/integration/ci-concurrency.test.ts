import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
test('Windows preview CI cancels superseded branch runs to conserve runners',async()=>{
 const yml=await readFile('.github/workflows/windows-build.yml','utf8');
 assert.match(yml,/concurrency:\s*\n\s+group:/);
 assert.match(yml,/cancel-in-progress: true/);
});
