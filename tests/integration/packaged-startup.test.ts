import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
test('Windows preview probes unpacked exe and persistent Data path',async()=>{
 const config=await readFile('.github/workflows/windows-build.yml','utf8');
 assert.match(config,/Smoke-check unpacked Windows executable/);
 assert.match(config,/registry\.sqlite/);
 assert.match(config,/Stop-Process/);
 assert.doesNotMatch(config,/continue-on-error: true/);
});
test('Windows preview uses npm ci with committed lockfile',async()=>{
 const config=await readFile('.github/workflows/windows-build.yml','utf8');
 assert.match(config,/run: npm ci/);
});
test('single-file Portable EXE is smoke-tested for Data next to the external EXE',async()=>{
 const config=await readFile('.github/workflows/windows-build.yml','utf8');
 assert.match(config,/Smoke-check single-file Portable EXE/);
 assert.match(config,/Data[\\/]registry\.sqlite/);
 assert.match(config,/Get-ChildItem release -File -Filter/);
});
