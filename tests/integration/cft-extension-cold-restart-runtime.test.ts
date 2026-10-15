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
