import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeSource} from '../src/index.ts';

const events=(source:string)=>analyzeSource({
 scriptId:'event-shadowing-fixture',
 sourceBytes:new TextEncoder().encode(source),
}).eventBindings;

test('FR-011 locally shadowed document and window event APIs cannot receive global DOM confidence',()=>{
 const records=events([
  'function local(document,window){',
  " document.addEventListener('input',handler);",
  " window.removeEventListener('scroll',handler);",
  ' document.onclick=handler;',
  '}',
  "document.addEventListener('global-click',handler);",
  "window.addEventListener('global-keydown',handler);",
  'window.onhashchange=handler;',
 ].join('\n'));
 assert.deepEqual(records.map(r=>[r.eventName,r.confidence,r.runtimeRequired]),[
  ['input','unknown',true],
  ['scroll','unknown',true],
  ['click','unknown',true],
  ['global-click','high',false],
  ['global-keydown','high',false],
  ['hashchange','high',false],
 ]);
 assert.ok(records.every(r=>r.evidenceLevel==='static-only'));
});

test('FR-011 block-scoped and hoisted var receivers are not actual global DOM event bindings',()=>{
 const records=events([
  '{',
  ' const window={addEventListener(){}};',
  " window.addEventListener('local-block',handler);",
  '}',
  'function local(){',
  " document.addEventListener('before-hoisted-var',handler);",
  ' var document={addEventListener(){}};',
  '}',
  "window.addEventListener('outside-block',handler);",
 ].join('\n'));
 assert.deepEqual(records.map(r=>[r.eventName,r.confidence,r.runtimeRequired]),[
  ['local-block','unknown',true],
  ['before-hoisted-var','unknown',true],
  ['outside-block','high',false],
 ]);
});

test('FR-011 dynamic with environment cannot prove the receiver is a DOM global',()=>{
 const records=events([
  "with (unknownObject) { document.addEventListener('dynamic-scope',handler); }",
  "document.addEventListener('ordinary-global',handler);",
 ].join('\n'));
 assert.deepEqual(records.map(r=>[r.eventName,r.confidence,r.runtimeRequired]),[
  ['dynamic-scope','unknown',true],
  ['ordinary-global','high',false],
 ]);
});
