import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {analyzeSource,parseUserscriptMetadata} from '../src/index.ts';
import type {SourceRange} from '../src/index.ts';

// Synthetic fixtures are data: never import, execute or eval .user.js contents.
function fixture(name:'static'|'dynamic'|'invalid'):Uint8Array {
  return readFileSync(fileURLToPath(new URL(`../../../fixtures/userscripts/${name}.user.js`,import.meta.url)));
}
const decode=(bytes:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);

// SourceRange is 1-based (line and column), columns count UTF-16 code units.
// Normalizing CRLF here reflects the same line boundaries as TypeScript AST.
function excerpt(source:string,range:SourceRange):string {
  const lines=source.split(/\r\n|\n|\r/);
  assert.ok(range.start.line>=1&&range.end.line<=lines.length);
  const start=range.start.line-1,end=range.end.line-1;
  if(start===end)return lines[start]!.slice(range.start.column-1,range.end.column-1);
  return [lines[start]!.slice(range.start.column-1),...lines.slice(start+1,end),lines[end]!.slice(0,range.end.column-1)].join('\n');
}

test('Task 5 static fixture: metadata retains repeated matches and fields',()=>{
  const metadata=parseUserscriptMetadata(decode(fixture('static')));
  assert.equal(metadata.name,'Fictional Static Selector Fixture');
  assert.deepEqual(metadata.match,['https://fixture.example.invalid/*','https://another.example.invalid/*']);
  assert.deepEqual(metadata.grant,['none']);
  assert.equal(metadata.runAt,'document-idle');
});

test('Task 5 metadata: missing, empty and duplicate tags follow current contract',()=>{
  const missing=parseUserscriptMetadata('// ==UserScript==\n// @match https://fixture.example.invalid/*\n// ==/UserScript==');
  assert.equal(missing.name,null);
  assert.deepEqual(missing.grant,[]);
  assert.equal(missing.runAt,null);
  const values=parseUserscriptMetadata('// ==UserScript==\n// @name\n// @name Second\n// @grant\n// @grant GM_getValue\n// @run-at\n// @run-at document-end\n// ==/UserScript==');
  assert.equal(values.name,'');
  assert.deepEqual(values.grant,['','GM_getValue']);
  assert.equal(values.runAt,'');
  assert.deepEqual(values.raw.name,['','Second']);
  assert.deepEqual(values.raw['run-at'],['','document-end']);
  // Current contract preserves duplicates rather than validating/rejecting them.
});

test('Task 5 static fixture: both fallback calls, scope and exact source ranges',()=>{
  const source=decode(fixture('static'));
  const analysis=analyzeSource({scriptId:'fixture-static',sourceBytes:fixture('static')});
  assert.deepEqual(analysis.parseDiagnostics,[]);
  const records=analysis.selectorRecords;
  const first=records.find(record=>record.method==='querySelector'&&record.expression==='#panel');
  const fallback=records.find(record=>record.method==='getElementById'&&record.expression==='panel-fallback');
  const closest=records.find(record=>record.method==='closest'&&record.expression==='.controls');
  assert.ok(first);assert.ok(fallback);assert.ok(closest);
  assert.deepEqual(first.alternateSelectors,['panel-fallback']);
  assert.deepEqual(fallback.alternateSelectors,['#panel']);
  assert.deepEqual(first.scope,['locatePanel']);
  assert.equal(first.functionName,'locatePanel');
  assert.deepEqual(first.sourceRange,{start:{line:10,column:17},end:{line:10,column:49}});
  assert.equal(excerpt(source,first.sourceRange),"document.querySelector('#panel')");
  assert.equal(excerpt(source,fallback.sourceRange),"document.getElementById('panel-fallback')");
  assert.equal(excerpt(source,closest.sourceRange),"panel?.closest('.controls')");
  assert.ok(records.every(record=>record.dynamicKind==='literal'&&!record.runtimeRequired));
});

test('Task 5 chained || fallback: inventory keeps all calls; immediate pairs are related',()=>{
  // Existing analyzer only relates direct children of each || node.
  const source="function chain(){ return document.querySelector('#a') || document.querySelector('#b') || document.getElementById('c'); }";
  const result=analyzeSource({scriptId:'fallback-chain',sourceBytes:new TextEncoder().encode(source)});
  assert.deepEqual(result.selectorRecords.map(record=>record.expression),['#a','#b','c']);
  assert.deepEqual(result.selectorRecords[0]?.alternateSelectors,['#b']);
  assert.deepEqual(result.selectorRecords[1]?.alternateSelectors,['#a']);
  // The outer RHS is recorded, but the current API does not flatten the nested LHS.
  assert.deepEqual(result.selectorRecords[2]?.alternateSelectors,[]);
});

test('Task 5 dynamic fixture: all unknown expressions require runtime confirmation',()=>{
  const analysis=analyzeSource({scriptId:'fixture-dynamic',sourceBytes:fixture('dynamic')});
  assert.deepEqual(analysis.parseDiagnostics,[]);
  for(const kind of ['template-dynamic','concat-dynamic','wrapper-unknown'] as const){
    assert.ok(analysis.selectorRecords.some(record=>record.dynamicKind===kind&&record.runtimeRequired===true),kind);
  }
  assert.equal(analysis.metadata.runAt,'document-end');
});

test('Task 5 nested functions expose complete lexical scope array',()=>{
  const source="function outer(){ function middle(){ const inner=()=>document.querySelector('#nested'); return inner; } return middle; }";
  const result=analyzeSource({scriptId:'nested',sourceBytes:new TextEncoder().encode(source)});
  assert.deepEqual(result.selectorRecords[0]?.scope,['outer','middle','inner']);
  assert.equal(result.selectorRecords[0]?.functionName,'inner');
  assert.equal(excerpt(source,result.selectorRecords[0]!.sourceRange),"document.querySelector('#nested')");
});

test('Task 5 original BOM/CRLF/Unicode bytes: hash and precise UTF-16 ranges',()=>{
  const source='// ==UserScript==\r\n// @name 字节验证\r\n// ==/UserScript==\r\nconst emoji="🎬"; document.querySelector("#中文");\r\n';
  const raw=new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(source)]);
  const result=analyzeSource({scriptId:'fixture-bom-crlf',sourceBytes:raw});
  assert.equal(result.sourceSha256,createHash('sha256').update(raw).digest('hex'));
  assert.equal(result.encoding,'utf-8-bom');
  assert.equal(result.lineEnding,'crlf');
  assert.deepEqual(result.parseDiagnostics,[]);
  const record=result.selectorRecords[0];
  assert.ok(record);
  assert.deepEqual(record.sourceRange,{start:{line:4,column:19},end:{line:4,column:48}});
  assert.equal(excerpt(source,record.sourceRange),'document.querySelector("#中文")');
  assert.equal(record.expression,'#中文');
  assert.notEqual(result.sourceSha256,createHash('sha256').update(raw.slice(3)).digest('hex'));
});

test('Task 5 static analyzer never executes top-level calls or side-effect sentinels',()=>{
  const key='__task5_fixture_never_execute__';
  const before=Object.getOwnPropertyDescriptor(globalThis,key);
  assert.equal(before,undefined,'sentinel must not preexist');
  const source=`globalThis.${key}=true;\nfunction explode(){ throw new Error('EXECUTED_USERSCRIPT'); }\nexplode();\ndocument.querySelector('#safe');`;
  const result=analyzeSource({scriptId:'non-executing',sourceBytes:new TextEncoder().encode(source)});
  assert.deepEqual(result.parseDiagnostics,[]);
  assert.equal(result.selectorRecords[0]?.expression,'#safe');
  assert.equal(Object.getOwnPropertyDescriptor(globalThis,key),undefined,'analyzer executed userscript');
});

test('Task 5 fixture inventory totals match the manually inspected synthetic source',()=>{
  // Phase 1 Task 5 Step 4: guard against silently missing or duplicated calls.
  // static: querySelector, getElementById, closest (all literals).
  // dynamic: template, concatenation, wrapper argument (all runtime-required).
  // invalid: no selector calls; its syntax error is asserted separately.
  for(const [name,expectedCount,expectedRuntime] of [
    ['static',3,0],
    ['dynamic',3,3],
    ['invalid',0,0],
  ] as const){
    const analysis=analyzeSource({scriptId:`counts-${name}`,sourceBytes:fixture(name)});
    assert.equal(analysis.selectorRecords.length,expectedCount,`${name}: selector count`);
    assert.equal(analysis.selectorRecords.filter(record=>record.runtimeRequired).length,
      expectedRuntime,`${name}: runtime-required count`);
  }
});

test('Task 5 invalid fixture: parser returns diagnostics instead of executing code',()=>{
  const bytes=fixture('invalid');
  const result=analyzeSource({scriptId:'fixture-invalid',sourceBytes:bytes});
  assert.ok(result.parseDiagnostics.length>0);
  assert.equal(result.sourceSha256,createHash('sha256').update(bytes).digest('hex'));
});
