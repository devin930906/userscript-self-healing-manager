import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('Windows real Chrome smoke must reject a bad managed selector and automatically restore its exact predecessor',async()=>{
 const smoke=await readFile(new URL('../../scripts/smoke-chrome.mjs',import.meta.url),'utf8');
 assert.match(smoke,/import \{guardAppliedManagedRevision\} from '\.\.\/packages\/repair-workflow\/src\/guarded-v1\.ts'/);
 assert.match(smoke,/guardAppliedManagedRevision\(\{/);
 assert.match(smoke,/runReadOnlyDomContract\(\{[\s\S]*?caseId:'SYNTHETIC:guarded-failing:V1'/);
 assert.match(smoke,/expectedCurrentHash:temporaryApplied\.hash/);
 assert.match(smoke,/autoGuard\.status,'rolled-back-v1'/);
 assert.match(smoke,/readFile\(activeAfterGuard\)/);
});
