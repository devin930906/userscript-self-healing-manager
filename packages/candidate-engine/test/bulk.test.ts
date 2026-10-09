import assert from 'node:assert/strict';
import {test} from 'node:test';
import {suggestMissingCandidatesBulk} from '../src/bulk.ts';
import type {MissingLocator} from '../src/workflow.ts';

const target={id:'one',url:'https://example.test/page'};
const missing=(expression:string):MissingLocator=>({method:'querySelector',expression,runtimeRequired:false});
const captured={targetId:target.id,url:target.url,scope:'top-document',nodes:[{tagName:'BUTTON',attributes:{id:'heal-button'}}]};
const deps=()=>({
 confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'main-frame',loaderId:'main-loader'}),
 probe:async(entries:readonly MissingLocator[])=>({targetId:target.id,url:target.url,
  checks:entries.map(x=>({method:x.method,expression:x.expression,status:x.expression.startsWith('#old')?'missing':'found',matchCount:x.expression.startsWith('#old')?0:1,...(!x.expression.startsWith('#old')?{nodeFingerprint:'a'.repeat(64)}:{})}))}),
 capture:async()=>captured,
});
test('bulk suggestions check all missing static locators without modifying scripts',async()=>{
 const locators=[missing('#old-one'),missing('#already-present'),missing('#old-two'),{...missing('#dynamic'),runtimeRequired:true}];
 const checks=locators.map((x,i)=>({method:x.method,expression:x.expression,
  status:i===0||i===2?'missing':i===1?'found':'unverified',matchCount:i===0||i===2?0:i===1?1:null}));
 const result=await suggestMissingCandidatesBulk({target,locators,checks,deps:deps()});
 assert.equal(result.validationLevel,'dom-only');
 assert.equal(result.totalMissing,2);
 assert.equal(result.checkedMissing,2);
 assert.equal(result.remainingMissing,0);
 assert.deepEqual(result.items.map(x=>x.selectorIndex),[0,2]);
 assert.ok(result.items[0]?.candidates.some(x=>x.expression==='#heal-button'));
 assert.ok(result.items.every(x=>x.candidates.every(c=>c.approved===false)));
 // The same newly discovered element must not be suggested twice for two old targets.
 assert.ok(!result.items[1]?.candidates.some(x=>x.expression==='#heal-button'));
});
test('bulk candidate requests fail closed on mismatched initial page identity',async()=>{
 await assert.rejects(suggestMissingCandidatesBulk({
  target,locators:[missing('#old-one')],
  checks:[{method:'querySelector',expression:'#old-one',status:'missing',matchCount:0}],
  evidenceIdentity:{targetId:'different',url:target.url},deps:deps(),
 }),/identity|target/i);
});
test('bulk candidate generation stays bounded at eight missing locators',async()=>{
 const locators=Array.from({length:12},(_,i)=>missing('#old-'+i));
 const result=await suggestMissingCandidatesBulk({target,locators,
  checks:locators.map(x=>({method:x.method,expression:x.expression,status:'missing',matchCount:0})),deps:deps()});
 assert.equal(result.totalMissing,12);
 assert.equal(result.checkedMissing,8);
 assert.equal(result.remainingMissing,4);
});

test('second bounded batch resumes at the ninth missing locator instead of repeating the first eight',async()=>{
 const locators=Array.from({length:12},(_,i)=>missing('#old-'+i));
 const checks=locators.map(x=>({method:x.method,expression:x.expression,status:'missing',matchCount:0}));
 const first=await suggestMissingCandidatesBulk({target,locators,checks,deps:deps(),offset:0});
 const second=await suggestMissingCandidatesBulk({target,locators,checks,deps:deps(),offset:8});
 assert.equal(first.candidateOffset,0);
 assert.equal(second.candidateOffset,8);
 assert.equal(first.items.length,8);
 assert.equal(second.items.length,4);
 assert.deepEqual(second.items.map(x=>x.selectorIndex),[8,9,10,11]);
 assert.equal(second.checkedMissing,12);
 assert.equal(second.remainingMissing,0);
 await assert.rejects(suggestMissingCandidatesBulk({target,locators,checks,deps:deps(),offset:-1}),/offset/i);
 await assert.rejects(suggestMissingCandidatesBulk({target,locators,checks,deps:deps(),offset:7}),/offset/i);
});
