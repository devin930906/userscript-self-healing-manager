import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

/**
 * RG-05 controlled Windows CFT experiment:
 * match the Chrome launch mode to an actual visible Windows application,
 * but preserve the previous pinned headless mode as the default control.
 * Neither mode may weaken the genuine official-manager cold-restart gate.
 */
test('RG-05 isolates headed Chrome window mode without weakening default Chrome sandbox',async()=>{
 const module=await import('../../scripts/violentmonkey-window-mode.ts').catch(()=>({} as Record<string,unknown>));
 const choose=(module as any).pinnedViolentmonkeyWindowFlags;
 assert.equal(typeof choose,'function','Missing explicit pinned CFT window-mode selector');
 assert.deepEqual(choose(undefined),['--headless=new']);
 assert.deepEqual(choose('headless'),['--headless=new']);
 assert.deepEqual(choose('headed'),[]);
 for(const invalid of ['', 'headless=old','Headed','--no-sandbox','false','1']){
  assert.throws(()=>choose(invalid),/Invalid isolated Chrome window mode/);
 }
 const smoke=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const workflow=await readFile('.github/workflows/dev-ci.yml','utf8');
 assert.match(smoke,/pinnedViolentmonkeyWindowFlags\(process\.env\.USSHM_RG05_CFT_WINDOW_MODE\)/);
 assert.match(smoke,/\.\.\.pinnedViolentmonkeyWindowFlags/);
 assert.match(workflow,/USSHM_RG05_CFT_WINDOW_MODE:\s*'headless'/,
  'headful compatibility was tested separately and did not clear official GM restart failure');
 assert.match(workflow,/Enforce both Chrome extension and official GM acceptance/);
 assert.match(smoke,/assertOfficialViolentmonkeyReleaseGate\(blocked\.status\)/);
 assert.doesNotMatch(smoke,/--no-sandbox/);
});


test('RG-05 background-networking A/B preserves default and proxy-isolated experiment',async()=>{
 const module=await import('../../scripts/violentmonkey-window-mode.ts');
 const select=(module as any).pinnedViolentmonkeyBackgroundNetworkFlags;
 assert.equal(typeof select,'function','Missing test-only background-network A/B selector');
 assert.deepEqual(select(undefined),['--disable-background-networking']);
 assert.deepEqual(select('disabled'),['--disable-background-networking']);
 assert.deepEqual(select('proxy-isolated'),[]);
 for(const invalid of ['', 'enabled','--no-sandbox','true','none']){
  assert.throws(()=>select(invalid),/Invalid isolated Chrome background-network mode/);
 }
 const smoke=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const workflow=await readFile('.github/workflows/dev-ci.yml','utf8');
 assert.match(smoke,/pinnedViolentmonkeyBackgroundNetworkFlags\(process\.env\.USSHM_RG05_CFT_BACKGROUND_NETWORK_MODE\)/);
 assert.match(smoke,/--proxy-server=http:\/\/127\.0\.0\.1:9/);
 assert.match(smoke,/--host-resolver-rules=MAP \* ~NOTFOUND/);
 assert.doesNotMatch(smoke,/--proxy-bypass-list=\\\*/);
 assert.doesNotMatch(smoke,/--no-sandbox/);
 assert.match(workflow,/USSHM_RG05_CFT_BACKGROUND_NETWORK_MODE:\s*'proxy-isolated'/);
 assert.match(smoke,/assertOfficialViolentmonkeyReleaseGate\(blocked\.status\)/);
});
