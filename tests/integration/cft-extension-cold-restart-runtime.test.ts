import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

/**
 * RG-05 root-cause control: distinguish an official-manager-specific cold
 * restart failure from a generic Chrome MV3 content-script runtime API loss.
 * The synthetic extension must prove chrome.runtime.onMessage.addListener is
 * available on the first localhost document both before and after restarting
 * the exact same disposable Chrome profile.
 */
test('RG-05 synthetic CFT control checks runtime.onMessage across a real Chrome process restart',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-extension-cft.mjs',import.meta.url),'utf8');
 assert.match(source,/data-usshm-extension-runtime-onmessage/,
  'synthetic content script must publish a bounded runtime.onMessage boolean marker');
 assert.match(source,/runtime\.onMessage.*addListener/s,
  'synthetic content script must inspect the same runtime messaging capability class');
 assert.match(source,/Browser\.close/,
  'control must close the first browser process before the cold restart');
 assert.match(source,/previousBrowserSocket/,
  'control must prove the restarted browser has a distinct CDP browser socket');
 assert.match(source,/previousChromePid/,
  'control must prove the restarted browser has a distinct OS process');
 assert.match(source,/same disposable profile|same profile/i,
  'control must explicitly retain the same disposable profile across restart');
 assert.match(source,/runtime messaging survived process restart/i,
  'control must report the bounded post-restart result without implying GM or V4 success');
});

test('RG-05 real synthetic MV3 control requires background/content message roundtrip on both browser processes',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-extension-cft.mjs',import.meta.url),'utf8');
 assert.match(source,/background\.js/,
  'a separate MV3 service worker must reply to the actual content script');
 assert.match(source,/chrome\.runtime\.onMessage\.addListener/,
  'a genuine extension runtime listener must respond; property checks alone are insufficient');
 assert.match(source,/chrome\.runtime\.sendMessage/,
  'content script must initiate runtime message delivery to the background service worker');
 assert.match(source,/data-usshm-extension-roundtrip/,
  'only a genuine received reply may publish a successful bounded fixture marker');
 assert.match(source,/expression:'\[data-usshm-extension-roundtrip="yes"\]'/,
  'CDP must require a positive roundtrip marker, not only onMessage availability');
 const evidence=await readFile(new URL('../../scripts/synthetic-extension-probe-evidence.ts',import.meta.url),'utf8');
 assert.equal([...source.matchAll(/classifySyntheticExtensionProbe\(probe,page\.id,fixtureUrl\)/g)].length,2,
  'both original and restarted document must use the same strict evidence classifier');
 assert.equal([...source.matchAll(/if\(stage==='verified'\)/g)].length,2,
  'both documents must require the exact verified classifier status');
 assert.match(evidence,/result\.checks\.length!==3/,
  'the helper must require exactly three independent observations');
 assert.match(evidence,/check\.status!=='found'\|\|check\.matchCount!==1/,
  'every independent marker must be found exactly once before success');
 assert.match(source,/roundtrip.*survived process restart/i,
  'stdout must distinguish genuine roundtrip from API availability');
 assert.doesNotMatch(source,/--no-sandbox|chrome\.userScripts\.register|GetInjected|GM_getValue/,
  'synthetic control cannot bypass sandbox, prewarm official manager or claim a GM pass');
});
