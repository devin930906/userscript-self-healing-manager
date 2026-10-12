import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {displayCdpPageOrigin} from '../../../packages/cdp-client/src/page-label.ts';

test('RG-07 Chrome page picker never receives username, password, private path, query tokens or fragment',()=>{
 const label=displayCdpPageOrigin('https://alice:SUPER_SECRET@private.example.invalid/accounts/alice/recovery?access_token=SECRET_ACCESS#private-chat');
 assert.equal(label,'https://private.example.invalid');
 for(const canary of ['alice','SUPER_SECRET','accounts','recovery','access_token','SECRET_ACCESS','private-chat'])
  assert.equal(label.includes(canary),false,canary);
 const other=displayCdpPageOrigin('http://fixture.example.invalid:8456/settings?session=HIDDEN');
 assert.equal(other,'http://fixture.example.invalid:8456');
});

test('RG-07 Chrome picker fail-closed labels for non-web and malformed targets without copying source text',()=>{
 for(const privateUrl of [
  'file:///C:/Users/SECRET_ACCOUNT/Desktop/private.html',
  'chrome-extension://unknown-extension/private',
  'about:blank',
  'not a valid URL?token=LEAK_CANARY',
  'https://',
  '',
 ]){
  const label=displayCdpPageOrigin(privateUrl);
  assert.equal(label,'[non-web/invalid page]');
  for(const secret of ['SECRET_ACCOUNT','private.html','LEAK_CANARY'])
   assert.equal(label.includes(secret),false);
 }
});

test('RG-07 Main must declassify CDP page display URLs before a renderer IPC result',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const handler=main.split("ipcMain.handle('usshm:cdp-status'")[1]?.split("ipcMain.handle('usshm:manager-targets'")[0]??'';
 assert.ok(handler,'verified CDP status IPC must remain registered');
 assert.match(handler,/origin:\s*displayCdpPageOrigin\(page\.url\)/);
 assert.doesNotMatch(handler,/url:\s*page\.url\b/,'never send the full browser-discovered URL to renderer');
 assert.match(handler,/getVerifiedChromeStatus/);
 assert.match(handler,/pages:status\.pages\.map/);
 const renderer=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(renderer,/p\.origin\.slice\(0,130\)/);
 assert.doesNotMatch(renderer,/p\.url\.slice\(0,130\)/);
});
