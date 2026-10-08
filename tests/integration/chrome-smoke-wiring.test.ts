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
 const workflow=readFileSync(join(process.cwd(),'.github/workflows/dev-ci.yml'),'utf8');
 assert.match(workflow,/node --experimental-strip-types scripts\/smoke-chrome\.mjs/);
 assert.doesNotMatch(workflow,/electron-builder|publish never|upload-artifact/);
});
