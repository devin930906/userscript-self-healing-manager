import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
test('Windows real Chrome smoke retests a stored managed revision selector, not the old source selector',async()=>{
 const smoke=await readFile(new URL('../../scripts/smoke-chrome.mjs',import.meta.url),'utf8');
 assert.match(smoke,/import \{readVerifiedManagedLocator\} from '\.\.\/packages\/repair-workflow\/src\/managed-locator\.ts'/);
 assert.match(smoke,/readVerifiedManagedLocator\(\{managedRoot:profile,scriptId:'chrome-smoke-fixture'/);
 assert.match(smoke,/runReadOnlyDomContract\(\{[\s\S]*?caseId:'SYNTHETIC:managed-applied:/);
 assert.match(smoke,/managedVerifiedLocator\.expression/);
 assert.match(smoke,/managedContract\.status,'passed'/);
 assert.match(smoke,/managedContract\.V3,'not-configured'/);
});
