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

test('invalid UTF-8 bytes cannot be silently analyzed and treated as a working userscript',()=>{
 const bytes=new Uint8Array([...encoder.encode('// ==UserScript==\n// @name Broken bytes\n// ==/UserScript==\ndocument.querySelector("#old");'),0xff,0xfe]);
 const analysis=analyzeSource({scriptId:'broken-utf8',sourceBytes:bytes});
 assert.equal(analysis.encoding,'invalid');
 assert.match(analysis.parseDiagnostics.join(' '),/UTF-8|encoding/i);
 assert.equal(analysis.selectorRecords.length,0);
});

test('userscript metadata tolerates blank lines inside header and still reads later activation rules',()=>{
 const src='// ==UserScript==\n// @name Example\n\n// @match https://example.org/*\n//\n// @grant GM_getValue\n// ==/UserScript==\n';
 const data=parseUserscriptMetadata(src);
 assert.deepEqual(data.match,['https://example.org/*']);
 assert.deepEqual(data.grant,['GM_getValue']);
});
test('metadata parsing never consumes code after the closing userscript marker',()=>{
 const src='// ==UserScript==\n// @name Safe\n// ==/UserScript==\n// @match https://attacker.example/*';
 assert.deepEqual(parseUserscriptMetadata(src).match,[]);
});

test('metadata parser rejects a forged UserScript header inserted after executable JavaScript',()=>{
 const src='window.changedByPage=true;\n// ==UserScript==\n// @match https://evil.example/*\n// ==/UserScript==\n';
 const meta=parseUserscriptMetadata(src);
 assert.deepEqual(meta.match,[]);
 assert.equal(meta.name,null);
 const analysis=analyzeSource({scriptId:'forged-header',sourceBytes:encoder.encode(src)});
 assert.deepEqual(analysis.metadata.match,[]);
});
test('metadata parser allows a benign leading line comment but not a header hidden inside a JS template',()=>{
 const legitimate='// userscript source header follows\n\n// ==UserScript==\n// @match https://safe.example/*\n// ==/UserScript==\n';
 assert.deepEqual(parseUserscriptMetadata(legitimate).match,['https://safe.example/*']);
 const injected='const html = `page\\n// ==UserScript==\\n// @match https://evil.example/*\\n// ==/UserScript==`;';
 assert.deepEqual(parseUserscriptMetadata(injected).match,[]);
});

test('computed DOM method calls are inventory items requiring runtime confirmation, not silently absent',()=>{
 const src=`
 const a=document['querySelector']('#settings');
 const b=document[dynamicMethod]('#unknown');
 const c=panel['matches']('.enabled');
 const d=document['querySelectorAll']('.rows');
 const e=other[arbitrary]('ignore');
 `;
 const data=analyzeSource({scriptId:'computed',sourceBytes:encoder.encode(src)});
 assert.deepEqual(data.selectorRecords.map(x=>x.method),[
  'querySelector','<computed>','matches','querySelectorAll',
 ]);
 assert.deepEqual(data.selectorRecords.map(x=>x.receiver),['document','document','panel','document']);
 assert.ok(data.selectorRecords.every(x=>x.runtimeRequired===true));
 assert.ok(data.selectorRecords.every(x=>x.dynamicKind==='wrapper-unknown'));
 assert.equal(data.selectorRecords[0]?.expression,'#settings');
 assert.equal(data.selectorRecords[1]?.expression,'#unknown');
});

test('prototype-shaped userscript metadata keys cannot crash or poison the metadata parser',()=>{
 const source=[
  '// ==UserScript==',
  '// @__proto__ hidden',
  '// @constructor override',
  '// @toString override',
  '// @hasOwnProperty override',
  '// @name Safe Header',
  '// @match https://example.org/*',
  '// ==/UserScript==',
  'document.querySelector("#safe");',
 ].join('\n');
 const metadata=parseUserscriptMetadata(source);
 assert.equal(metadata.name,'Safe Header');
 assert.deepEqual(metadata.match,['https://example.org/*']);
 for(const key of ['__proto__','constructor','toString','hasOwnProperty']){
  assert.equal(Object.hasOwn(metadata.raw,key),true,key);
  assert.equal(Array.isArray(metadata.raw[key]),true,key);
 }
 assert.equal(Object.getPrototypeOf(metadata.raw),null);
 const analysis=analyzeSource({scriptId:'untrusted-metadata',sourceBytes:encoder.encode(source)});
 assert.equal(analysis.metadata.name,'Safe Header');
 assert.equal(analysis.selectorRecords.length,1);
 assert.equal(analysis.parseDiagnostics.length,0);
});

test('an unfinished userscript header never authorizes a page match or a GM grant',()=>{
 const unclosed=[
  '// ==UserScript==',
  '// @name Incomplete Manager Header',
  '// @match https://example.org/*',
  '// @grant GM_xmlhttpRequest',
  'document.querySelector("#test");',
 ].join('\n');
 const metadata=parseUserscriptMetadata(unclosed);
 assert.equal(metadata.name,null);
 assert.deepEqual(metadata.match,[]);
 assert.deepEqual(metadata.grant,[]);
 assert.deepEqual(Object.keys(metadata.raw),[]);
 const analysis=analyzeSource({scriptId:'unfinished',sourceBytes:encoder.encode(unclosed)});
 assert.equal(analysis.selectorRecords.length,1,'AST inventory remains available without metadata authorization');
 assert.deepEqual(analysis.metadata.match,[]);
});

test('a forged closing marker with extra text does not authorize userscript metadata',()=>{
 const source=[
  '// ==UserScript==',
  '// @name Fake',
  '// @match https://example.org/*',
  '// ==/UserScript== trailing content',
  'document.querySelector("#test");',
 ].join('\n');
 assert.deepEqual(parseUserscriptMetadata(source).match,[]);
});

test('parenthesized logical-OR DOM calls retain symmetric fallback selector inventory',()=>{
 const src=[
  "const choice = ((document.querySelector('#primary'))) || ((document.querySelector('#fallback')));",
  "const unrelated = (document.querySelector('.left')) && (document.querySelector('.right'));",
 ].join('\n');
 const records=analyzeSource({scriptId:'grouped-fallback',sourceBytes:encoder.encode(src)}).selectorRecords;
 assert.deepEqual(records.map(record=>record.expression),['#primary','#fallback','.left','.right']);
 assert.deepEqual(records.map(record=>record.alternateSelectors),[
  ['#fallback'],['#primary'],[],[],
 ]);
});


test('AST inventories getElementsByTagName literal and computed method without executing script',()=>{
 const source=[
  "const nodes=document.getElementsByTagName('article');",
  "const item=root.getElementsByTagName('button');",
  "const viaKey=document['getElementsByTagName']('section');",
 ].join('\n');
 const records=analyzeSource({scriptId:'tag-name-inventory',sourceBytes:encoder.encode(source)}).selectorRecords;
 assert.deepEqual(records.map(x=>x.method),['getElementsByTagName','getElementsByTagName','getElementsByTagName']);
 assert.deepEqual(records.map(x=>x.expression),['article','button','section']);
 assert.deepEqual(records.map(x=>x.receiver),['document','root','document']);
 assert.deepEqual(records.map(x=>x.runtimeRequired),[false,false,true]);
});


test('single-layer nullish DOM fallback links both selector calls symmetrically',()=>{
 const source="const selected = (document.querySelector('#primary')) ?? (document.querySelector('#fallback'));";
 const records=analyzeSource({scriptId:'nullish-fallback',sourceBytes:encoder.encode(source)}).selectorRecords;
 assert.deepEqual(records.map(x=>x.expression),['#primary','#fallback']);
 assert.deepEqual(records.map(x=>x.alternateSelectors),[['#fallback'],['#primary']]);
});

test('FR-011 inventories event bindings as static candidates without running script',()=>{
 const source=[
  "const node=document.querySelector('#run');",
  "node.addEventListener('click',()=>{ throw Error('MUST_NOT_RUN'); });",
  "window.removeEventListener('scroll',handler);",
  "node.onclick=handler;",
  "service.addEventListener('custom', handler);",
 ].join('\n');
 const result=analyzeSource({scriptId:'events',sourceBytes:encoder.encode(source)});
 assert.deepEqual(result.eventBindings.map(x=>[x.kind,x.eventName,x.confidence,x.runtimeRequired]),[
  ['addEventListener','click','unknown',true],
  ['removeEventListener','scroll','high',false],
  ['on-property','click','unknown',true],
  ['addEventListener','custom','unknown',true],
 ]);
 assert.equal(result.eventBindings.every(x=>x.evidenceLevel==='static-only'),true);
 assert.equal(result.eventBindings.every(x=>x.sourceRange.start.line>0),true);
 assert.equal(result.selectorRecords.length,1);
});

test('FR-010 metadata preserves exclude require version and reports missing/conflicting single-value tags',()=>{
 const source=[
  '// ==UserScript==',
  '// @name One',
  '// @name Two',
  '// @match https://example.invalid/*',
  '// @exclude https://example.invalid/private/*',
  '// @require https://cdn.invalid/helpers.js',
  '// @version 1.0.0',
  '// @version 2.0.0',
  '// ==/UserScript==',
 ].join('\n');
 const metadata=parseUserscriptMetadata(source);
 assert.deepEqual(metadata.exclude,['https://example.invalid/private/*']);
 assert.deepEqual(metadata.require,['https://cdn.invalid/helpers.js']);
 assert.equal(metadata.version,'1.0.0');
 assert.ok(metadata.diagnostics.some(x=>x.includes('duplicate')&&x.includes('name')));
 assert.ok(metadata.diagnostics.some(x=>x.includes('duplicate')&&x.includes('version')));
 const missing=parseUserscriptMetadata('// ==UserScript==\n// @name Only\n// ==/UserScript==');
 assert.ok(missing.diagnostics.some(x=>x.includes('match')));
});

test('FR-011 inventories MutationObserver construction and observe options statically without invoking callbacks',()=>{
 const source=[
  "const observer = new MutationObserver(() => { throw Error('MUST_NOT_RUN'); });",
  "observer.observe(document.body, {childList:true, subtree:true});",
  "observer.disconnect();",
  "new MutationObserver(handleMutation).observe(target, dynamicOptions);",
 ].join('\n');
 const result=analyzeSource({scriptId:'synthetic-mutation',sourceBytes:encoder.encode(source)});
 assert.deepEqual(result.mutationObservers.map(x=>[x.kind,x.receiver,x.runtimeRequired]),[
  ['constructor','MutationObserver',false],
  ['observe','observer',false],
  ['observe','<constructed>',true],
  ['constructor','MutationObserver',false],
 ]);
 assert.equal(result.mutationObservers.every(x=>x.evidenceLevel==='static-only'&&x.functionalVerified===false),true);
 assert.equal(result.mutationObservers[1]?.sourceRange.start.line,2);
 assert.equal(result.mutationObservers[2]?.optionsKind,'dynamic');
});

test('FR-011 does not certify unrelated model.observe as a MutationObserver operation',()=>{
 const source=[
  "const model = { observe(target, options) { return options.childList; } };",
  "model.observe(target, {childList:true});",
  "const observer = new MutationObserver(() => {});",
  "observer.observe(target, {childList:true});",
 ].join('\n');
 const records=analyzeSource({scriptId:'synthetic-unrelated-observe',sourceBytes:encoder.encode(source)}).mutationObservers;
 const unrelated=records.filter(x=>x.kind==='observe'&&x.receiver==='model');
 assert.ok(unrelated.length>0,'Unrelated observe candidate must be present');
 assert.equal(unrelated.every(x=>x.runtimeRequired===true),true,
  'An arbitrary observe method must not be certified as a MutationObserver');
 assert.equal(records.some(x=>x.kind==='observe'&&x.receiver==='observer'&&x.runtimeRequired===false),true);
});

test('FR-011 observer binding honors lexical parameters catch and local declarations',()=>{
 const source=[
  "const observer = new MutationObserver(() => {});",
  "observer.observe(target,{childList:true});",
  "function parameter(observer) { observer.observe(target,{childList:true}); }",
  "function localLet() { let observer; observer.observe(target,{childList:true}); }",
  "function localVar() { observer.observe(target,{childList:true}); var observer; }",
  "try { throw 1; } catch (observer) { observer.observe(target,{childList:true}); }",
  "function sameScope() { const own = new MutationObserver(()=>{}); own.observe(target,{childList:true}); }",
 ].join('\n');
 const rows=analyzeSource({scriptId:'synthetic-shadow',sourceBytes:encoder.encode(source)}).mutationObservers.filter(x=>x.kind==='observe');
 assert.deepEqual(rows.map(x=>x.runtimeRequired),[false,true,true,true,true,false]);
 assert.equal(rows.every(x=>x.evidenceLevel==='static-only'&&x.functionalVerified===false),true);
});

test('FR-011 with dynamic object shadowing cannot certify an observer receiver outside the with body',()=>{
 const source=[
  "const observer = new MutationObserver(() => {});",
  "observer.observe(target,{childList:true});",
  "with ({observer: fake}) { observer.observe(target,{childList:true}); }",
  "observer.observe(target,{childList:true});",
 ].join('\n');
 const calls=analyzeSource({scriptId:'synthetic-with-shadow',sourceBytes:encoder.encode(source)})
  .mutationObservers.filter(x=>x.kind==='observe');
 assert.deepEqual(calls.map(x=>x.runtimeRequired),[false,true,false]);
 assert.deepEqual(calls.map(x=>x.sourceRange.start.line),[2,3,4]);
});

test('FR-011 with may shadow the MutationObserver constructor itself',()=>{
 const source=[
  "const outside = new MutationObserver(() => {});",
  "outside.observe(target,{childList:true});",
  "with ({MutationObserver: Fake}) {",
  " const observer = new MutationObserver(() => {});",
  " observer.observe(target,{childList:true});",
  "}",
  "outside.observe(target,{childList:true});",
 ].join('\n');
 const records=analyzeSource({scriptId:'fake-with-constructor',sourceBytes:encoder.encode(source)}).mutationObservers;
 assert.deepEqual(records.map(x=>[x.kind,x.runtimeRequired]),[
  ['constructor',false],['observe',false],
  ['constructor',true],['observe',true],['observe',false],
 ]);
});

test('FR-011 globalThis constructor reassignment makes MutationObserver evidence unknown',()=>{
 const source=[
  "globalThis.MutationObserver = Fake;",
  "const observer = new MutationObserver(cb);",
  "observer.observe(target,{childList:true});",
 ].join('\n');
 const records=analyzeSource({scriptId:'synthetic-global-rebind',sourceBytes:encoder.encode(source)}).mutationObservers;
 assert.deepEqual(records.map(x=>[x.kind,x.runtimeRequired]),[['constructor',true],['observe',true]]);
});
test('FR-011 observe method overwrite invalidates bound observer certainty',()=>{
 const source=[
  "const observer = new MutationObserver(cb);",
  "observer.observe = fakeObserve;",
  "observer.observe(target,{childList:true});",
 ].join('\n');
 const records=analyzeSource({scriptId:'synthetic-observe-override',sourceBytes:encoder.encode(source)}).mutationObservers;
 assert.deepEqual(records.map(x=>[x.kind,x.runtimeRequired]),[['constructor',false],['observe',true]]);
});

test('FR-011 computed global constructor assignment invalidates static identity',()=>{
 const source=[
  'globalThis["MutationObserver"] = Fake;',
  'const observer = new MutationObserver(cb);',
  'observer.observe(target,{childList:true});',
 ].join('\n');
 const records=analyzeSource({scriptId:'computed-constructor-rebind',sourceBytes:encoder.encode(source)}).mutationObservers;
 assert.deepEqual(records.map(x=>[x.kind,x.runtimeRequired]),[['constructor',true],['observe',true]]);
});
test('FR-011 computed observe method assignment invalidates static identity',()=>{
 const source=[
  'const observer = new MutationObserver(cb);',
  'observer["observe"] = fakeObserve;',
  'observer.observe(target,{childList:true});',
 ].join('\n');
 const records=analyzeSource({scriptId:'computed-observe-overwrite',sourceBytes:encoder.encode(source)}).mutationObservers;
 assert.deepEqual(records.map(x=>[x.kind,x.runtimeRequired]),[['constructor',false],['observe',true]]);
});

test('FR-011 prototype observe overwrite invalidates instance observation without invalidating construction',()=>{
 const source=[
  'MutationObserver.prototype.observe = fakeObserve;',
  'const observer = new MutationObserver(cb);',
  'observer.observe(target,{childList:true});',
  'const unaffected = {observe(target,opts) { return opts; }};',
  'unaffected.observe(target,{childList:true});',
 ].join('\n');
 const records=analyzeSource({scriptId:'prototype-observe-overwrite',sourceBytes:encoder.encode(source)}).mutationObservers;
 assert.deepEqual(records.filter(x=>x.receiver==='MutationObserver'||x.receiver==='observer').map(x=>[x.kind,x.runtimeRequired]),[
  ['constructor',false],['observe',true],
 ]);
 assert.ok(records.some(x=>x.receiver==='unaffected'&&x.runtimeRequired===true));
});
