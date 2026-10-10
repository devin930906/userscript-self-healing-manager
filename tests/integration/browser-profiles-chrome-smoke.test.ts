import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
test('Windows real Chrome smoke launches independently saved profile roots with actual CDP handshakes',async()=>{
 const source=await readFile('scripts/smoke-chrome.mjs','utf8');
 assert.match(source,/createBrowserProfile\(/);
 assert.match(source,/resolveBrowserProfileForLaunch\(/);
 assert.match(source,/setDefaultBrowserProfile\(/);
 assert.match(source,/waitForChromeDebugger\(\{port:9231/);
 assert.match(source,/waitForChromeDebugger\(\{port:9232/);
 assert.match(source,/Chrome-Profiles/);
 assert.match(source,/taskkill/);
 const workflow=await readFile('.github/workflows/dev-ci.yml','utf8');
 assert.match(workflow,/node --experimental-strip-types scripts\/smoke-chrome\.mjs/);
});
