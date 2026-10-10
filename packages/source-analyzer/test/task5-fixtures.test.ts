import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {analyzeSource,parseUserscriptMetadata} from '../src/index.ts';

// Resolve fixtures relative to this test, independent of process.cwd().
function fixture(name:'static'|'dynamic'|'invalid'):Uint8Array {
  return readFileSync(fileURLToPath(new URL(`../../../fixtures/userscripts/${name}.user.js`,import.meta.url)));
}
const decode=(bytes:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);

test('Task 5 static fixture: metadata is parsed without executing source',()=>{
  const metadata=parseUserscriptMetadata(decode(fixture('static')));
  assert.equal(metadata.name,'Fictional Static Selector Fixture');
  assert.deepEqual(metadata.match,[
    'https://fixture.example.invalid/*','https://another.example.invalid/*'
  ]);
  assert.deepEqual(metadata.grant,['none']);
  assert.equal(metadata.runAt,'document-idle');
});

test('Task 5 static fixture: selectors, fallback, function and source ranges',()=>{
  const bytes=fixture('static');
  const analysis=analyzeSource({scriptId:'fixture-static',sourceBytes:bytes});
  assert.deepEqual(analysis.parseDiagnostics,[]);
  const records=analysis.selectorRecords;
  const first=records.find(record=>record.method==='querySelector'&&record.expression==='#panel');
  const fallback=records.find(record=>record.method==='getElementById'&&record.expression==='panel-fallback');
  const closest=records.find(record=>record.method==='closest'&&record.expression==='.controls');
  assert.ok(first,'querySelector record');
  assert.ok(fallback,'getElementById record');
  assert.ok(closest,'closest record');
  assert.ok(first.alternateSelectors.includes('panel-fallback'),'logical fallback recorded');
  assert.equal(first.functionName,'locatePanel');
  assert.ok(first.scope.includes('locatePanel'));
  assert.ok(first.sourceRange.start.line>0);
  assert.ok(first.sourceRange.end.line>=first.sourceRange.start.line);
  assert.ok(first.sourceRange.start.column>0);
  assert.equal(first.dynamicKind,'literal');
  assert.equal(first.runtimeRequired,false);
});

test('Task 5 dynamic fixture: template, concatenation and wrapper remain runtime-required',()=>{
  const analysis=analyzeSource({scriptId:'fixture-dynamic',sourceBytes:fixture('dynamic')});
  assert.deepEqual(analysis.parseDiagnostics,[]);
  for(const kind of ['template-dynamic','concat-dynamic','wrapper-unknown'] as const){
    assert.ok(analysis.selectorRecords.some(record=>record.dynamicKind===kind&&record.runtimeRequired===true),
      `missing runtime-required ${kind}`);
  }
  assert.equal(analysis.metadata.runAt,'document-end');
});

test('Task 5 source SHA-256 hashes original BOM + CRLF bytes, not decoded text',()=>{
  const raw=new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(
    '// ==UserScript==\r\n// @name 字节验证\r\n// @match https://fixture.example.invalid/*\r\n// @grant none\r\n// @run-at document-idle\r\n// ==/UserScript==\r\nfunction locate(){ return document.querySelector("#byte"); }\r\n'
  )]);
  const result=analyzeSource({scriptId:'fixture-bom-crlf',sourceBytes:raw});
  assert.equal(result.sourceSha256,createHash('sha256').update(raw).digest('hex'));
  assert.equal(result.encoding,'utf-8-bom');
  assert.equal(result.lineEnding,'crlf');
  assert.deepEqual(result.parseDiagnostics,[]);
  assert.equal(result.selectorRecords[0]?.expression,'#byte');
  const withoutBom=raw.slice(3);
  assert.notEqual(result.sourceSha256,createHash('sha256').update(withoutBom).digest('hex'));
});

test('Task 5 invalid fixture: syntax failures are diagnostics, not thrown exceptions',()=>{
  const result=analyzeSource({scriptId:'fixture-invalid',sourceBytes:fixture('invalid')});
  assert.ok(result.parseDiagnostics.length>0,'expected parser diagnostic');
  assert.equal(result.sourceSha256,createHash('sha256').update(fixture('invalid')).digest('hex'));
});
