import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeSource} from '../src/index.ts';

const analyze=(source:string)=>analyzeSource({scriptId:'synthetic-scope-fixture',sourceBytes:Buffer.from(source)});
test('FR-019 named function expressions retain their lexical name in selector source evidence',()=>{
 const result=analyze(`function outer(){
  const assigned=function inner(){ document.querySelector('#save'); };
 }`);
 const selector=result.selectorRecords[0]!;
 assert.equal(selector.functionName,'inner');
 assert.deepEqual(selector.scope,['outer','inner']);
 assert.equal(selector.sourceRange.start.line,2);
});

test('FR-013 anonymous functions assigned to variables retain their inferred scope for all AST evidence',()=>{
 const result=analyze(`const handler=function(){
  document.querySelector('#save');
  document.addEventListener('click',()=>{});
  const observer=new MutationObserver(()=>{});
 };`);
 assert.equal(result.selectorRecords[0]?.functionName,'handler');
 assert.equal(result.eventBindings[0]?.functionName,'handler');
 assert.equal(result.mutationObservers[0]?.functionName,'handler');
 assert.deepEqual(result.selectorRecords[0]?.scope,['handler']);
});

test('an anonymous immediately invoked expression remains unnamed without inventing a function label',()=>{
 const result=analyze(`(function(){ document.querySelector('#save'); })();`);
 assert.equal(result.selectorRecords[0]?.functionName,null);
 assert.deepEqual(result.selectorRecords[0]?.scope,[]);
});
