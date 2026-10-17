import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

const devPath='.github/workflows/dev-ci.yml';
const releasePath='.github/workflows/windows-build.yml';
const script='node --experimental-strip-types scripts/smoke-violentmonkey-cft.mjs';

test('PR validation requires real Chrome 155 and MV3 while the separate Stable GM gate runs on integration pushes',async()=>{
 const source=await readFile(devPath,'utf8');
 const stable=await readFile('.github/workflows/stable-rg05-gate.yml','utf8');
 assert.match(source,/pull_request:\s*\n\s+branches: \[main, feat\/v01-continuation\]/);
 assert.match(source,/push:\s*\n\s+branches: \[feat\/v01-continuation\]/);
 const chrome=source.split(/^  chrome155:\s*$/m)[1];
 assert.ok(chrome,'dedicated Chrome 155 job must exist on PRs');
 assert.match(chrome,/scripts\/smoke-chrome\.mjs/);
 assert.match(chrome,/scripts\/smoke-extension-cft\.mjs/);
 assert.doesNotMatch(chrome,/continue-on-error|smoke-violentmonkey-cft\.mjs/,
  'development smoke must remain mandatory and independent of official GM acceptance');
 assert.match(stable,/push:\s*\n\s+branches: \[feat\/v01-continuation\]/);
 assert.match(stable,/workflow_dispatch:/);
 const setup=stable.split('- name: Fetch pinned official Violentmonkey 2.49.0 MV3 release for isolated integration')[1];
 assert.ok(setup,'verified official manager acquisition must remain present');
 const gm=stable.split('- name: Real Violentmonkey 2.49.0 GM API integration in isolated CFT 155 profile (synthetic loopback only)')[1];
 assert.ok(gm,'mandatory real GM receipt assertion must remain present');
 assert.match(gm,/scripts\/smoke-violentmonkey-cft\.mjs/);
 assert.doesNotMatch(stable,/continue-on-error|if:\s*false|\|\|\s*true/);
});

test('final-tag-only packaging refuses to build any edition before real pinned official GM cold-restart acceptance',async()=>{
 const release=await readFile(releasePath,'utf8');
 const installer=release.split(/^  windows:\s*$/m)[1];
 assert.ok(installer,'final-tag-only Windows packaging job must exist');
 assert.match(installer,/if: github\.event_name == 'workflow_dispatch'/);
 const authorization=installer.indexOf('node scripts/final-build-authorization.mjs');
 const npmInstall=installer.indexOf('run: npm ci');
 const manager=installer.indexOf(script);
 const packaging=installer.indexOf('run: npm run dist:win');
 assert.ok(authorization>=0&&npmInstall>authorization&&manager>npmInstall&&packaging>manager,
  'verified official GM acceptance must be enforced after tag authorization and before packaging');
 assert.match(installer,/155\.0\.8059\.39\/win64\/chrome-win64\.zip/);
 assert.match(installer,/node scripts\/download-violentmonkey-release\.mjs \$archive/);
 assert.match(installer,/3fa676c803a9698453ed23dfe496d4bc29a4bec52f6a95e55c43c2955921f8ee/);
 assert.match(installer,/USSHM_SMOKE_EXPECT_CHROME_MAJOR:\s*'155'/);
 assert.match(installer,/Pinned official Violentmonkey archive SHA-256 mismatch/);
 assert.doesNotMatch(installer,/continue-on-error:\s*true|if:\s*false|\|\| true/);
});
