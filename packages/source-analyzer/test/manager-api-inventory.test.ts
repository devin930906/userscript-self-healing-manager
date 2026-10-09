import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeSource} from '../src/index.ts';

const analyze=(source:string)=>analyzeSource({scriptId:'gm-contract',sourceBytes:new TextEncoder().encode(source)});

test('AST inventories legacy and modern GM calls without executing script or reading string/comment lookalikes',()=>{
 const data=analyze(`// ==UserScript==
// @name Manager contract
// @match https://example.org/*
// @grant GM_getValue
// @grant GM.setValue
// ==/UserScript==
// GM_removeCookie('fake') in a comment
const txt = "GM_download('fake')"; 
GM_getValue('a');
GM.setValue('a','b');
GM['deleteValue']('a');
GM[dynamicName]('a');
`);
 assert.deepEqual(data.managerApiCalls.map(x=>x.api),[
  'GM_getValue','GM.setValue','GM.deleteValue','GM.<dynamic>',
 ]);
 assert.deepEqual(data.managerApiCalls.map(x=>x.grantStatus),[
  'declared','declared','missing','unknown',
 ]);
 assert.ok(data.managerApiCalls.every(x=>x.line>0&&x.column>0));
 assert.ok(data.managerApiCalls.every(x=>x.evidenceLevel==='static-only'));
 assert.ok(data.managerApiCalls.every(x=>x.managerVerified===false));
});

test('an explicit @grant none never certifies GM API availability and missing declaration stays review-only',()=>{
 const data=analyze(`// ==UserScript==
// @name No grants
// @grant none
// ==/UserScript==
GM_getValue('foo'); GM.getValue('foo');
`);
 assert.deepEqual(data.managerApiCalls.map(x=>x.grantStatus),['missing','missing']);
 assert.ok(data.managerApiCalls.every(x=>x.managerVerified===false));
});

test('unrelated calls, property lookalikes and plain metadata @grant without runtime usage do not invent manager execution',()=>{
 const data=analyze(`// ==UserScript==
// @grant GM_setValue
// ==/UserScript==
const other={GM_getValue(){return 4;}};other.GM_getValue(); 
window.GM_setValue('x',1);
console.log("GM_setValue()");
// GM_setValue('ignored')
`);
 assert.deepEqual(data.managerApiCalls,[]);
});

test('invalid UTF-8 source reports no trusted static GM API inventory',()=>{
 const bytes=new Uint8Array([0xff,0xfe]);
 const data=analyzeSource({scriptId:'invalid-manager-source',sourceBytes:bytes});
 assert.deepEqual(data.managerApiCalls,[]);
 assert.equal(data.encoding,'invalid');
});
