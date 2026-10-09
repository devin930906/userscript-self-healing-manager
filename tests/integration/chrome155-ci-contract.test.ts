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
