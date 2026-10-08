import assert from 'node:assert/strict';import {test} from 'node:test';import {readFile} from 'node:fs/promises';
test('Windows release configuration declares Setup and Portable EXE',async()=>{
 const s=await readFile('build/electron-builder.yml','utf8');assert.match(s,/target:\s*nsis/);assert.match(s,/target:\s*portable/);assert.match(s,/Setup-/);assert.match(s,/Portable-/);
});
test('Windows workflow creates a full directory ZIP, not wrapped portable exe',async()=>{
 const s=await readFile('.github/workflows/windows-build.yml','utf8');
 assert.match(s,/CreateFromDirectory/);assert.match(s,/\.usshm-portable/);assert.match(s,/win-unpacked/);assert.match(s,/upload-artifact/);
});
