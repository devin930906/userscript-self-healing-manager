import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rankSelectorCandidates} from '../src/index.ts';

test('untrusted candidate evidence refuses excessive per-node attribute cardinality before ranking',()=>{
 const attributes=Object.fromEntries(Array.from({length:65},(_,i)=>['untrusted-'+i,'text']));
 attributes.id='safe-button';
 assert.throws(()=>rankSelectorCandidates({
  method:'querySelector',oldSelector:'#old-button',
  nodes:[{tagName:'BUTTON',attributes}],
 }),/attribute|budget|limit|bound/i);
});

test('untrusted candidate evidence refuses oversized class attributes before splitting them',()=>{
 assert.throws(()=>rankSelectorCandidates({
  method:'getElementsByClassName',oldSelector:'old-panel',
  nodes:[{tagName:'DIV',attributes:{class:'panel '.repeat(100000)}}],
 }),/attribute|budget|limit|bound/i);
});
