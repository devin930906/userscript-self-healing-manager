import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('real Chrome for Testing extension fixture uses isolated profile, loopback target and no user Chrome',async()=>{
 const smoke=await readFile(new URL('../../scripts/smoke-extension-cft.mjs',import.meta.url),'utf8');
 for(const re of [
  /process\.platform\s*!==\s*'win32'/,
  /USSHM_SMOKE_EXPECT_CHROME_MAJOR/,
  /ChromeForTesting-155/,
  /mkdtemp\(/,
  /127\.0\.0\.1/,
  /--load-extension=/,
  /--disable-extensions-except=/,
  /getVerifiedChromeStatus\(/,
  /confirmPageIdentity\(/,
  /probePageLocators\(/,
  /taskkill/,
 ]){
  assert.match(smoke,re);
 }
 assert.doesNotMatch(smoke,/Runtime\.evaluate|Input\.dispatchMouseEvent|Tampermonkey\/GM.*passed/i);
});

test('CFT 155 development CI runs the isolated extension smoke, without creating installers or production extension hooks',async()=>{
 const workflow=await readFile(new URL('../../.github/workflows/dev-ci.yml',import.meta.url),'utf8');
 const i=workflow.indexOf('name: Real Chrome 155 CDP compatibility (no installers)');
 const cft=workflow.slice(i);
 assert.ok(i>0);
 assert.match(cft,/node --experimental-strip-types scripts\/smoke-extension-cft\.mjs/);
 assert.match(cft,/USSHM_SMOKE_EXPECT_CHROME_MAJOR: '155'/);
 assert.doesNotMatch(cft,/electron-builder|dist:win|actions\/upload-artifact/);
 for(const file of [
  '../../apps/desktop/src/main/index.ts',
  '../../apps/desktop/src/preload/index.ts',
  '../../apps/desktop/src/renderer/App.tsx',
 ]){
  const text=await readFile(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(text,/smoke-extension-cft|--load-extension=/);
 }
});

test('test-only unpacked extension script is restricted to the loopback fixture and never claims GM certification',async()=>{
 const smoke=await readFile(new URL('../../scripts/smoke-extension-cft.mjs',import.meta.url),'utf8');
 assert.match(smoke,/"manifest_version":3/);
 assert.match(smoke,/http:\/\/127\.0\.0\.1\/\*/);
 assert.match(smoke,/data-usshm-extension-fixture/);
 assert.match(smoke,/NOT Tampermonkey|not Tampermonkey/i);
 assert.doesNotMatch(smoke,/GM_setValue\s*\(|GM_xmlhttpRequest\s*\(/);
});
