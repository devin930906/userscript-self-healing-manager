import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('Windows CI runs a separate real Chrome 155 fixture smoke with pinned official browser binary',async()=>{
 const workflow=await readFile('.github/workflows/dev-ci.yml','utf8');
 assert.match(workflow,/chrome155:\s*\n/);
 assert.match(workflow,/runs-on:\s*windows-latest/);
 assert.match(workflow,/storage\.googleapis\.com\/chrome-for-testing-public\/155\.0\.8059\.39\/win64\/chrome-win64\.zip/);
 assert.match(workflow,/\$installRoot\s*=\s*Join-Path \$env:ProgramFiles 'USSHM-ChromeForTesting-155'/);
 assert.match(workflow,/Expand-Archive -LiteralPath \$archive -DestinationPath \$installRoot/);
 assert.doesNotMatch(workflow,/Expand-Archive -LiteralPath \$archive -DestinationPath \$env:RUNNER_TEMP/,
  'Windows sandbox cannot execute Chrome binaries from the hosted runner temp directory');
 assert.doesNotMatch(workflow,/--no-sandbox/,'do not weaken Chrome sandbox to make tests pass');
 assert.match(workflow,/CHROME_PATH=\$exe/);
 assert.match(workflow,/USSHM_SMOKE_EXPECT_CHROME_MAJOR:\s*'155'/);
 assert.match(workflow,/node --experimental-strip-types scripts\/smoke-chrome\.mjs/);
 assert.doesNotMatch(workflow,/npm run dist:win|npm run package|electron-builder|npm publish/,
  'compatibility test must never create preview installers, releases or publish');
});
test('real Chrome CDP smoke checks the requested major version instead of treating any Chrome as compatible',async()=>{
 const src=await readFile('scripts/smoke-chrome.mjs','utf8');
 assert.match(src,/USSHM_SMOKE_EXPECT_CHROME_MAJOR/);
 assert.match(src,/verifiedDebugger\.browser/);
 assert.match(src,/throw new Error\('Chrome smoke browser major mismatch/);
});

test('RG-05 PR synthetic CDP stays strict while official GM is a separate fail-closed Stable gate',async()=>{
 const dev=await readFile('.github/workflows/dev-ci.yml','utf8');
 const stable=await readFile('.github/workflows/stable-rg05-gate.yml','utf8');
 const devChrome=dev.split(/^  chrome155:\s*$/m)[1];
 assert.ok(devChrome,'dedicated Chrome 155 development job must exist');
 assert.match(dev,/pull_request:\s*\n\s*branches:\s*\[main, feat\/v01-continuation\]/);
 assert.match(devChrome,/scripts\/smoke-extension-cft\.mjs/);
 assert.doesNotMatch(devChrome,/continue-on-error|scripts\/smoke-violentmonkey-cft\.mjs/,
  'development Chrome synthetic smoke is mandatory but cannot certify the official manager');
 assert.match(stable,/push:\s*\n\s*branches:\s*\[feat\/v01-continuation\]/);
 assert.match(stable,/workflow_dispatch:/);
 assert.match(stable,/runs-on:\s*windows-latest/);
 const synthetic=stable.indexOf('name: Real Chrome for Testing 155 isolated MV3 extension load (NOT Tampermonkey)');
 const official=stable.indexOf('name: Real Violentmonkey 2.49.0 GM API integration in isolated CFT 155 profile');
 assert.ok(synthetic>=0&&official>synthetic,
  'the independent synthetic and official real-browser checks must run sequentially');
 assert.match(stable.slice(official),/scripts\/smoke-violentmonkey-cft\.mjs/);
 assert.doesNotMatch(stable,/continue-on-error|if:\s*false|\|\|\s*true/,
  'neither real-browser failure can be suppressed or passed as a Stable gate');
});
