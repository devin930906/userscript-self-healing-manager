import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeSource,parseUserscriptMetadata} from '../src/index.ts';
const encoder=new TextEncoder();

test('metadata handles repeated @match and @grant and @run-at',()=>{
 const src=`// ==UserScript==\n// @name  DOM Helper\n// @match https://chatgpt.com/*\n// @match https://example.com/*\n// @grant GM_getValue\n// @run-at document-idle\n// ==/UserScript==\n`;
 const m=parseUserscriptMetadata(src);
 assert.equal(m.name,'DOM Helper');assert.deepEqual(m.match,['https://chatgpt.com/*','https://example.com/*']);assert.deepEqual(m.grant,['GM_getValue']);assert.equal(m.runAt,'document-idle');
});
test('AST inventory records literal selectors and source line',()=>{
 const src=`function save() {\n const item = document.querySelector('#send') || document.querySelector('[data-testid="send"]');\n const btn = item?.closest('button');\n}`;
 const r=analyzeSource({scriptId:'t1',sourceBytes:encoder.encode(src)});
 assert.equal(r.selectorRecords.length,3);
 assert.deepEqual(r.selectorRecords.map(x=>x.expression),['#send','[data-testid="send"]','button']);
 assert.equal(r.selectorRecords[0]?.sourceRange.start.line,2);
 assert.equal(r.selectorRecords[0]?.functionName,'save');
 assert.deepEqual(r.selectorRecords[0]?.alternateSelectors,['[data-testid="send"]']);
});
test('dynamic template and concatenation are flagged runtime-required, not executed',()=>{
 const src='const s = document.querySelector(`[data-id="${window.secret()}"]`);\nconst x = document.getElementById("send" + suffix);';
 const r=analyzeSource({scriptId:'t2',sourceBytes:encoder.encode(src)});
 assert.deepEqual(r.selectorRecords.map(x=>x.dynamicKind),['template-dynamic','concat-dynamic']);
 assert.equal(r.selectorRecords.every(x=>x.runtimeRequired),true);
});
test('syntax error reports diagnostics rather than executing arbitrary script',()=>{
 const src='window.nasty(); const x = (';
 const r=analyzeSource({scriptId:'t3',sourceBytes:encoder.encode(src)});
 assert.ok(r.parseDiagnostics.length>0);
});
test('BOM and CRLF produce correct byte hash and lineEnding',async()=>{
 const sourceBytes=new Uint8Array([239,187,191,...encoder.encode('const a = document.querySelector(".x");\r\n')]);
 const r=analyzeSource({scriptId:'t4',sourceBytes});
 const {createHash}=await import('node:crypto');assert.equal(r.sourceSha256,createHash('sha256').update(sourceBytes).digest('hex'));
 assert.equal(r.encoding,'utf-8-bom');assert.equal(r.lineEnding,'crlf');
});
test('AST records document vs element receiver, so DOM checks cannot mistake nested scope',()=>{
 const source="const target = document.querySelector('.outer');\ntarget.querySelector('.child');\ndocument.getElementById('ok');";
 const r=analyzeSource({scriptId:'scoped',sourceBytes:encoder.encode(source)});
 assert.deepEqual(r.selectorRecords.map(x=>x.receiver),['document','target','document']);
});
