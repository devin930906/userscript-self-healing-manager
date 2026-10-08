import assert from 'node:assert/strict';
import {test} from 'node:test';
import {suggestCandidateRepairs} from '../src/workflow.ts';
const locator={method:'querySelector',expression:'#save-old',runtimeRequired:false};
const target={id:'alpha',url:'https://example.org'};
const safeNodes=[{tagName:'BUTTON',attributes:{'data-testid':'save-button'}}];
const deps={
 probe:async(inputs:readonly {method:string;expression:string;runtimeRequired:boolean}[])=>({targetId:'alpha',url:'https://example.org',checks:inputs.map(input=>({method:input.method,expression:input.expression,status:input.expression==='#save-old'?'missing':'found',matchCount:input.expression==='#save-old'?0:1}))}),
 capture:async()=>({targetId:'alpha',url:'https://example.org',scope:'top-document',nodes:safeNodes})
};
test('confirmed missing CSS locator produces uniquely live-verified read-only suggestions',async()=>{
 const result=await suggestCandidateRepairs({target,locator,deps});
 assert.equal(result.length,1);assert.equal(result[0]?.expression,'[data-testid="save-button"]');
 assert.equal(result[0]?.validationLevel,'dom-candidate-verified');assert.equal(result[0]?.approved,false);
});
test('present or runtime-bound original locator never triggers snapshot candidate generation',async()=>{
 let snapshots=0;
 const custom={probe:async(inputs:readonly typeof locator[])=>({...await deps.probe(inputs),checks:inputs.map(x=>({method:x.method,expression:x.expression,status:'found',matchCount:1}))}),capture:async()=>{snapshots++;return deps.capture();}};
 assert.deepEqual(await suggestCandidateRepairs({target,locator,deps:custom}),[]);
 assert.equal(snapshots,0);
 assert.deepEqual(await suggestCandidateRepairs({target,locator:{...locator,runtimeRequired:true},deps}),[]);
});
test('stale page URL and identity are blocked before returning a candidate',async()=>{
 await assert.rejects(suggestCandidateRepairs({target,locator,deps:{...deps,capture:async()=>({...await deps.capture(),targetId:'changed'})}}),/identity/i);
 await assert.rejects(suggestCandidateRepairs({target,locator,deps:{...deps,probe:async inputs=>({...await deps.probe(inputs),url:'https://other.example'})}}),/identity/i);
});
test('rejects snapshot-only candidate that no longer matches exactly one live node',async()=>{
 const testDeps={...deps,probe:async(inputs:readonly typeof locator[])=>({...await deps.probe(inputs),checks:inputs.map(input=>({method:input.method,expression:input.expression,status:input.expression==='#save-old'?'missing':'ambiguous',matchCount:input.expression==='#save-old'?0:2}))})};
 assert.deepEqual(await suggestCandidateRepairs({target,locator,deps:testDeps}),[]);
});
