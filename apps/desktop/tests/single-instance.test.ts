import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('main Electron process acquires a single-instance lock before opening SQLite or managed repair workflow',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 assert.match(main,/app\.requestSingleInstanceLock\(\)/);
 assert.match(main,/app\.on\('second-instance'/);
 assert.match(main,/if\(!singleInstanceLock\)app\.quit\(\)/);
 assert.match(main,/else\s*bootstrap\(\)\.catch\(/);
 assert.ok(main.indexOf('app.requestSingleInstanceLock()')<main.indexOf('bootstrap().catch'));
});
test('Windows real Electron startup smoke actually checks a second instance exits while the first is alive',()=>{
 const smoke=readFileSync('scripts/smoke-electron-dev.mjs','utf8');
 assert.match(smoke,/secondInstance/);
 assert.match(smoke,/secondExited/);
 assert.match(smoke,/assert\.ok\(secondExited/);
 assert.match(smoke,/assert\.equal\(exitStatus,null/);
});
