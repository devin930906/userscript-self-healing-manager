import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import * as fixture from './iframe-cdp-attach.ts';

const trust='file:///C:/synthetic/dist/index.html';
const func=(fixture as Record<string,unknown>).attachSyntheticSecurityIframeViaCdp;

function run(input:{docUrl?:string;hostId?:number;onCall?:(method:string)=>void}={}){
 const calls:Array<{method:string;params:Record<string,unknown>}>=[];
 let active=0;
 const exec=func as (options:{
  expectedUrl:string;call:(method:string,params?:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  assertAlive:()=>void;
 })=>Promise<void>;
 const promise=exec({
  expectedUrl:trust,
  assertAlive:()=>{active++;},
  call:async(method,params={})=>{
   calls.push({method,params});input.onCall?.(method);
   if(method==='DOM.getDocument')return {root:{nodeId:17,documentURL:input.docUrl??trust}};
   if(method==='DOM.querySelector')return {nodeId:input.hostId??24};
   if(method==='DOM.setOuterHTML')return {};
   throw Error('unexpected '+method);
  },
 });
 return {calls,promise,alive:()=>active};
}

test('QA-048 authentic CDP DOM commands attach only the fixed synthetic srcdoc iframe without Runtime.evaluate navigation',async()=>{
 assert.equal(typeof func,'function','missing CDP DOM iframe attach that avoids JavaScript context suspension');
 const r=run();
 await r.promise;
 assert.deepEqual(r.calls.map(x=>x.method),['DOM.getDocument','DOM.querySelector','DOM.setOuterHTML']);
 assert.equal(r.calls[1].params.nodeId,17);
 assert.equal(r.calls[1].params.selector,'#usshm-security-probe-host');
 assert.equal(r.calls[2].params.nodeId,24);
 const html=r.calls[2].params.outerHTML;
 assert.equal(typeof html,'string');
 assert.match(html as string,/usshm-security-probe/);
 assert.match(html as string,/FRAME_MARKER_44/);
 assert.match(html as string,/srcdoc=/);
 assert.doesNotMatch(html as string,/https?:\/\/|file:\/\//);
 assert.ok(r.alive()>=3);
});

test('QA-048 the synthetic iframe mutation aborts if the document changed or CDP host went stale',async()=>{
 assert.equal(typeof func,'function');
 for(const testCase of [
  {docUrl:'https://untrusted.invalid/secret',hostId:24},
  {docUrl:'file:///C:/private/different.html',hostId:24},
  {docUrl:trust,hostId:0},
 ]){
  const r=run(testCase);
  await assert.rejects(r.promise,(error:unknown)=>{
   assert.ok(error instanceof Error);
   assert.match(error.message,/trusted.*document|fixture.*host|renderer/i);
   assert.doesNotMatch(error.message,/secret|private|untrusted.invalid/);
   return true;
  });
  assert.equal(r.calls.some(x=>x.method==='DOM.setOuterHTML'),false,
   'never mutate a mismatched renderer or unresolved synthetic host');
 }
});

test('QA-048 real Electron security runner never starts iframe navigation in Runtime.evaluate',async()=>{
 const source=await readFile('apps/desktop/tests/electron-security.integration.test.ts','utf8');
 assert.match(source,/await attachSyntheticSecurityIframeViaCdp\(/);
 const begin=source.indexOf("await t.test('iframe must load marker");
 const end=source.indexOf("await t.test('CSP rejects dynamic base URI",begin);
 assert.ok(begin>=0&&end>begin);
 const stage=source.slice(begin,end);
 assert.doesNotMatch(stage,/setTimeout\(\(\)=>document\.body\.append\(frame\),0\)/);
 assert.match(stage,/Page\.createIsolatedWorld/);
 assert.match(stage,/FRAME_MARKER_44/);
 assert.match(stage,/\[outcome\.bridge,outcome\.ipc,outcome\.node\]/);
});
