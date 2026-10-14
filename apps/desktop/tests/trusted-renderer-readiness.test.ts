import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {waitForTrustedRendererReady,type TrustedRendererState} from './trusted-renderer-readiness.ts';

const trusted='file:///C:/app/dist/index.html';
const ready:TrustedRendererState={
 href:trusted,readyState:'complete',topLevel:true,
 hasGetAppInfo:true,hasGenericInvoke:false,hasNode:false,hasRawIpc:false,
};
const options=(extra:Partial<Parameters<typeof waitForTrustedRendererReady>[1]>={})=>({
 expectedUrl:trusted,attempts:4,pause:async()=>{},assertAlive:()=>{},...extra,
});

test('QA-048 waits until the actual trusted main document preload bridge is ready',async()=>{
 let calls=0,pauses=0;
 const stages:[TrustedRendererState|null,TrustedRendererState,TrustedRendererState]=[
  null,{...ready,readyState:'loading',hasGetAppInfo:false},ready,
 ];
 await waitForTrustedRendererReady(
  async()=>stages[calls++]??null,
  options({pause:async()=>{pauses++;}})
 );
 assert.equal(calls,3,'a target in /json/list is not necessarily a loaded renderer');
 assert.equal(pauses,2);
});

test('QA-048 rejects absent preload at a finite deadline instead of silently continuing',async()=>{
 let calls=0;
 await assert.rejects(
  waitForTrustedRendererReady(async()=>{calls++;return {...ready,hasGetAppInfo:false};},options()),
  /preload.*not ready|trusted renderer.*not ready/i
 );
 assert.equal(calls,4,'no unbounded retry or fabricated ready bridge');
});

test('QA-048 rejects a changed URL, subframe, Node or raw IPC without treating any as ready',async()=>{
 const malicious:TrustedRendererState[]=[
  {...ready,href:'file:///C:/app/dist/alternate.html'},
  {...ready,topLevel:false},
  {...ready,hasNode:true},
  {...ready,hasRawIpc:true},
  {...ready,hasGenericInvoke:true},
 ];
 for(const state of malicious){
  let calls=0;
  await assert.rejects(waitForTrustedRendererReady(async()=>{calls++;return state;},options()),
   /untrusted|unsafe|security|frame|origin|bridge/i);
  assert.equal(calls,1,'security failures must not be converted to transient waits');
 }
});

test('QA-048 stops if Electron exits and preserves unexpected diagnostic failures',async()=>{
 let aliveChecks=0;
 await assert.rejects(waitForTrustedRendererReady(async()=>null,
  options({assertAlive:()=>{if(++aliveChecks>1)throw new Error('Electron child exited');}})),/Electron child exited/);
 assert.equal(aliveChecks,2);
 await assert.rejects(waitForTrustedRendererReady(async()=>{throw new Error('unexpected CDP failure');},options()),
  /unexpected CDP failure/);
});

test('QA-048 real Electron integration must execute readiness gate before security assertions',()=>{
 const integration=readFileSync(new URL('./electron-security.integration.test.ts',import.meta.url),'utf8');
 const gate=integration.indexOf('await waitForTrustedRendererReady(');
 const trust=integration.indexOf("await t.test('trusted main frame has only the allowlisted bridge");
 assert.ok(gate>=0&&trust>gate,'readiness barrier must be awaited after CDP enable and before any security probes');
 assert.match(integration,/import \{waitForTrustedRendererReady\} from '\.\/trusted-renderer-readiness\.ts'/);
});

test('QA-048 malformed CDP snapshot fails immediately without treating it as preload latency',async()=>{
 const malformed:unknown[]=[
  {}, {...ready,href:undefined}, {...ready,readyState:'destroyed'},
  {...ready,topLevel:'true'}, {...ready,hasGetAppInfo:1},
  {...ready,hasGenericInvoke:undefined}, {...ready,hasNode:null},
  {...ready,hasRawIpc:'false'},
 ];
 for(const value of malformed){
  let calls=0;
  await assert.rejects(waitForTrustedRendererReady(async()=>{
   calls++;
   return value as TrustedRendererState;
  },options()),/Malformed trusted renderer readiness probe/);
  assert.equal(calls,1,'malformed CDP result cannot exhaust transient retry budget');
 }
});

test('QA-048 rejects missing options and noncallable callbacks before touching CDP',async()=>{
 const badOptions:unknown[]=[
  undefined,null,{}, {...options(),pause:null},
  {...options(),assertAlive:undefined}, {...options(),attempts:101},
  {...options(),expectedUrl:'https://example.invalid/'},
 ];
 for(const candidate of badOptions){
  let probes=0;
  await assert.rejects(waitForTrustedRendererReady(async()=>{probes++;return ready;},
   candidate as Parameters<typeof waitForTrustedRendererReady>[1]),/Unsafe trusted renderer readiness options/);
  assert.equal(probes,0,'invalid readiness configuration must not invoke CDP');
 }
 await assert.rejects(waitForTrustedRendererReady(null as unknown as ()=>Promise<TrustedRendererState|null>,
  options()),/Unsafe trusted renderer readiness options/);
});

test('QA-048 rejects a changed renderer document with a bounded privacy-safe failure category',async()=>{
 const cases=[
  {state:{...ready,href:'file:///C:/private/account/profile.html?auth=SENSITIVE_TOKEN'},category:'different-file-document'},
  {state:{...ready,href:'https://secret.invalid/path?token=SENSITIVE_TOKEN'},category:'non-file-document'},
  {state:{...ready,topLevel:false},category:'subframe'},
 ];
 for(const {state,category} of cases){
  let calls=0;
  await assert.rejects(waitForTrustedRendererReady(async()=>{calls++;return state;},options()),
   (error:unknown)=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/Untrusted renderer document or frame during readiness check/);
    assert.ok(error.message.includes('reason='+category),'a fixed reason identifies the broken trust boundary');
    assert.ok(error.message.includes('ready=complete'),'only a bounded readiness enum may appear');
    assert.ok(error.message.includes('preload=present'),'only a boolean-derived bridge status may appear');
    for(const secret of ['SENSITIVE_TOKEN','secret.invalid','private/account','profile.html','https://']){
     assert.ok(!error.message.includes(secret),'untrusted URL and private values must never leak to CI');
    }
    assert.ok(error.message.length<=220,'diagnostics must remain bounded');
    return true;
   });
  assert.equal(calls,1,'untrusted document/frame must never be polled away');
 }
});

test('QA-048 exhausted readiness probes explain missing-context versus missing-preload without URLs',async()=>{
 const cases=[
  {snapshot:null,expected:'last=no-context'},
  {snapshot:{...ready,readyState:'loading',hasGetAppInfo:false},expected:'last=loading'},
  {snapshot:{...ready,readyState:'complete',hasGetAppInfo:false},expected:'last=missing-preload'},
 ];
 for(const {snapshot,expected} of cases){
  let calls=0;
  await assert.rejects(waitForTrustedRendererReady(async()=>{calls++;return snapshot;},options({
   attempts:2,
  })),(error:unknown)=>{
   assert.ok(error instanceof Error);
   assert.match(error.message,/Trusted renderer preload not ready within bounded probes/);
   assert.ok(error.message.includes(expected),'CI must distinguish lifecycle versus bridge latency');
   assert.ok(!error.message.includes(trusted),'never disclose the expected file path');
   return true;
  });
  assert.equal(calls,2);
 }
});

test('QA-048 retries only bounded initial Runtime.evaluate transport timeouts, never unsafe CDP errors',async()=>{
 let probes=0;
 await waitForTrustedRendererReady(async()=>{
  probes++;
  if(probes===1)throw new Error('CDP call timed out: Runtime.evaluate');
  return ready;
 },options());
 assert.equal(probes,2);
 probes=0;
 await assert.rejects(waitForTrustedRendererReady(async()=>{
  probes++;
  throw new Error('CDP call timed out: Runtime.evaluate');
 },options({attempts:3})),/trusted renderer.*not ready|preload.*not ready/i);
 assert.equal(probes,3);
 for(const message of ['CDP call timed out: Page.navigate','CDP disconnected','unsafe bridge']){
  probes=0;
  await assert.rejects(waitForTrustedRendererReady(async()=>{
   probes++;
   throw new Error(message);
  },options()),(error:unknown)=>error instanceof Error&&error.message===message);
  assert.equal(probes,1);
 }
});
