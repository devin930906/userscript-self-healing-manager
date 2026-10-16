import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {assertChromeDebuggerPortFree} from '../../packages/cdp-client/src/index.ts';

// QA-004/005: match the real Chrome launcher boundary, not a mocked success.
test('Windows Chrome smoke refuses an occupied debugger before its first spawn',async()=>{
 const source=await readFile('scripts/smoke-chrome.mjs','utf8');
 const entry=source.indexOf("const fixtureUrl='http://127.0.0.1:'");
 const spawn=source.indexOf('chrome=spawn(executable,');
 const preflight=source.indexOf('await assertChromeDebuggerPortFree(9223);');
 assert.ok(entry>=0&&spawn>entry,'a real loopback fixture must precede the first Chrome spawn');
 assert.ok(preflight>entry&&preflight<spawn,
  'check the actual port 9223 before spawning Chrome; never attach to a pre-existing debugger');
 assert.ok(source.indexOf('await confirmPageIdentity(candidate);')>spawn,
  'port preflight does not replace the live page/frame/loader identity check');
});

test('occupied loopback debugger refuses startup even when the listener is not Chrome',async()=>{
 const server=createServer();
 await new Promise<void>((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 try{
  const address=server.address();
  assert.ok(address&&typeof address!=='string');
  await assert.rejects(assertChromeDebuggerPortFree(address.port),
   /CDP port .*already in use or unavailable on 127\.0\.0\.1/);
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 }
});
