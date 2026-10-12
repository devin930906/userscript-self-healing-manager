import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('QA-002 Windows real Chrome smoke validates the exact selected executable with production PE preflight before spawning',()=>{
 const script=readFileSync('scripts/smoke-chrome.mjs','utf8');
 const imported=script.indexOf("import {assertWindowsPeExecutable} from '../packages/cdp-client/src/pe-executable.ts';");
 const chosen=script.indexOf("if(!executable)throw new Error(");
 const preflight=script.indexOf('await assertWindowsPeExecutable(executable);');
 const spawned=script.indexOf('chrome=spawn(executable,');
 assert.ok(imported>=0,'smoke must load the SAME production PE verifier');
 assert.ok(chosen>=0&&preflight>chosen&&spawned>preflight,
  'validate actual Chrome binary after resolved executable and before its first spawn');
 const pipeline=readFileSync('.github/workflows/dev-ci.yml','utf8');
 assert.match(pipeline,/CHROME_PATH=\$exe/);
 assert.match(pipeline,/smoke-chrome\.mjs/);
 assert.match(pipeline,/155\.0\.8059\.39\/win64\/chrome-win64\.zip/);
});
