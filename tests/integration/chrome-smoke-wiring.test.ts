import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

test('Windows development CI runs real isolated Chrome CDP smoke without installer packaging',()=>{
 const script=join(process.cwd(),'scripts','smoke-chrome.mjs');
 assert.ok(existsSync(script),'a real Chrome protocol smoke harness must exist');
 const source=readFileSync(script,'utf8');
 assert.match(source,/buildChromeLaunchArgs/);
 assert.match(source,/getChromeStatus/);
 assert.match(source,/confirmPageIdentity/);
 assert.match(source,/captureDomSummary/);
 assert.match(source,/probePageLocators/);
 assert.match(source,/collectPagedDomDiagnosis/,'Chrome smoke must cover complete multi-page DOM collection');
 const workflow=readFileSync(join(process.cwd(),'.github/workflows/dev-ci.yml'),'utf8');
 assert.match(workflow,/node --experimental-strip-types scripts\/smoke-chrome\.mjs/);
 assert.doesNotMatch(workflow,/electron-builder|publish never|upload-artifact/);
});

test('Windows Chrome smoke proves synthetic userscript behavior changes only after a verified managed repair',()=>{
 const source=readFileSync(join(process.cwd(),'scripts','smoke-chrome.mjs'),'utf8');
 assert.match(source,/runIsolatedFixtureBehavior/,'must run synthetic code in the disposable test-only page');
 assert.match(source,/assert\.equal\(baselineBehavior,false\)/,'unrepaired synthetic script must fail behavior verification');
 assert.match(source,/assert\.equal\(repairedBehavior,true\)/,'managed repaired script must produce the intended browser effect');
 assert.match(source,/assert\.equal\(restoredBehavior,false\)/,'restored original should return to baseline');
 const main=readFileSync(join(process.cwd(),'apps','desktop','src','main','index.ts'),'utf8');
 assert.doesNotMatch(main,/Runtime\.evaluate|runIsolatedFixtureBehavior/,'production desktop remains CDP read-only');
});
