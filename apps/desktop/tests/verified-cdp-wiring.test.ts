import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('all privileged desktop CDP operations verify real Chrome WebSocket identity on each discovery',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 assert.match(main,/import \{getVerifiedChromeStatus,launchSelectedChrome\}/);
 assert.doesNotMatch(main,/getChromeStatus\(/,
  'production must never trust HTTP-only Chrome identity after port changes');
 const verifications=main.match(/getVerifiedChromeStatus\(\{port:9223\}\)/g)??[];
 assert.ok(verifications.length>=12,
  'status plus every diagnostic/probe/repair/role check must verify the browser socket');
});
