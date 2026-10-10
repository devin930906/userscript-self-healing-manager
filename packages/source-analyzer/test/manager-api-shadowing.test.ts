import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeSource} from '../src/index.ts';

const inspect=(source:string)=>analyzeSource({
 scriptId:'shadow-gm-fixture',
 sourceBytes:new TextEncoder().encode(source),
}).managerApiCalls.map(c=>c.api);

test('locally declared GM objects are not actual userscript-manager API calls',()=>{
 const calls=inspect(`// ==UserScript==
// @name Local GM fixture
// @grant GM.getValue
// @grant GM_getValue
// ==/UserScript==
const GM={getValue(){return 'local'}};
GM.getValue('key');
GM['getValue']('key');
GM_getValue('actual-global');
`);
 assert.deepEqual(calls,['GM_getValue']);
});

test('function parameters and local destructuring bindings mask manager identifiers only in their own scope',()=>{
 const calls=inspect(`function local(GM,GM_setValue){
  GM.setValue('k',1);
  GM_setValue('k',1);
  { const {GM_getValue}=helpers; GM_getValue('k'); }
}
GM.setValue('outside',1);
GM_getValue('outside');
`);
 assert.deepEqual(calls,['GM.setValue','GM_getValue']);
});

test('hoisted var/function declarations shadow manager-name calls even before their declaration',()=>{
 const calls=inspect(`function local(){
 GM_getValue('early');
 if (true) { var GM_getValue=()=>1; }
 GM_deleteValue('another local');
 function GM_deleteValue(){return 2;}
}
GM_getValue('real');
`);
 assert.deepEqual(calls,['GM_getValue']);
});

test('for-loop let bindings, catch bindings and named function expressions are not mistaken for GM calls',()=>{
 const calls=inspect(`for (const GM of [{getValue(){}}]) GM.getValue('local');
try { throw new Error('fixture'); } catch (GM) { GM.setValue('local',1); }
const other=function GM_getValue(){ GM_getValue('recursive'); };
GM.getValue('global');
GM_deleteValue('global');
`);
 assert.deepEqual(calls,['GM.getValue','GM_deleteValue']);
});

test('import-bound GM names do not become evidence of Tampermonkey execution',()=>{
 const calls=inspect(`import { GM_getValue } from './safe-local.js';
GM_getValue('imported');
GM.setValue('real-global');
`);
 assert.deepEqual(calls,['GM.setValue']);
});
