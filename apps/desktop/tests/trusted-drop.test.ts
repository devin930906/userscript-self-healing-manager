import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
test('no renderer-callable bridge accepts arbitrary File objects or filesystem paths as a new import grant',async()=>{
 const s=await readFile('apps/desktop/src/preload/index.ts','utf8');
 assert.doesNotMatch(s,/grantDroppedFiles\s*:/);
 assert.match(s,/event\.isTrusted/);
 assert.match(s,/addEventListener\(['"]drop['"]/);
 assert.match(s,/webUtils\.getPathForFile/);
 assert.match(s,/ipcRenderer\.invoke\(['"]usshm:grant-drops['"]/);
});
test('trusted native drag-and-drop is delivered by subscription, not caller-supplied paths',async()=>{
 const p=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const ui=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(p,/onTrustedDrop:/);
 assert.match(ui,/ussm\.onTrustedDrop/);
 assert.doesNotMatch(ui,/ussm\.grantDroppedFiles/);
});
test('development branch only builds installers on explicit dispatch, not on every commit',async()=>{
 const release=await readFile('.github/workflows/windows-build.yml','utf8');
 assert.doesNotMatch(release,/push:\s*\n\s+branches:/);
 const ci=await readFile('.github/workflows/dev-ci.yml','utf8');
 assert.match(ci,/push:\s*\n\s+branches:/);
 assert.doesNotMatch(ci,/electron-builder|upload-artifact/);
});
