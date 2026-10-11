import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

test('development CI launches built Electron GUI with isolated Windows AppData without generating installers',()=>{
 const path=join('scripts','smoke-electron-dev.mjs');
 assert.ok(existsSync(path),'native desktop startup must be verified, not merely compiled');
 const source=readFileSync(path,'utf8');
 assert.match(source,/ELECTRON_RUN_AS_NODE/,'launch GUI Electron rather than Electron-as-Node');
 assert.match(source,/PORTABLE_EXECUTABLE_DIR/,'use a test-only portable data root, never the runner user profile');
 assert.match(source,/registry\.sqlite/,'wait for real portable Data SQLite initialization');
 assert.match(source,/taskkill/,'kill only the test-created Electron process tree');
 const workflow=readFileSync('.github/workflows/dev-ci.yml','utf8');
 assert.match(workflow,/node scripts\/smoke-electron-dev\.mjs/);
 assert.doesNotMatch(workflow,/npm run dist:win|electron-builder|upload-artifact/);
});
