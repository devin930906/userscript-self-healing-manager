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
test('branch pushes and PRs only run release contracts; installers require explicit authorized dispatch',async()=>{
 const release=await readFile('.github/workflows/windows-build.yml','utf8');
 const ci=await readFile('.github/workflows/dev-ci.yml','utf8');

 // Branch and PR events are safe because this job validates contracts only.
 assert.match(release,/^\s{2}pull_request:\s*\n\s{4}branches: \[feat\/v01-continuation\]/m);
 assert.match(release,/^\s{2}push:\s*\n\s{4}branches: \[feat\/v01-continuation\]/m);
 const contractJob=release.split(/^\s{2}release-contracts:\s*$/m)[1]?.split(/^\s{2}windows:\s*$/m)[0];
 assert.ok(contractJob,'missing development release-contracts job');
 assert.match(contractJob,/if: github\.event_name == 'pull_request' \|\| github\.event_name == 'push'/);
 assert.match(contractJob,/run: npm run typecheck/);
 assert.match(contractJob,/run: node --experimental-strip-types --test /);
 assert.doesNotMatch(contractJob,/npm run dist:win|electron-builder|upload-artifact/);

 // Installer authorization remains isolated in the manually dispatched job.
 const installerJob=release.split(/^\s{2}windows:\s*$/m)[1];
 assert.ok(installerJob,'missing restricted installer job');
 assert.match(installerJob,/if: github\.event_name == 'workflow_dispatch'/);
 const authorize=installerJob.indexOf('run: node scripts/final-build-authorization.mjs');
 const install=installerJob.indexOf('run: npm ci');
 const packageBuild=installerJob.indexOf('run: npm run dist:win');
 assert.ok(authorize>=0 && install>authorize && packageBuild>install,
  'tag authorization must run before dependencies and packaging');
 assert.match(ci,/push:\s*\n\s+branches:/);
 assert.doesNotMatch(ci,/electron-builder|upload-artifact/);
});
