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

test('malformed DOM tag names cannot coerce into a candidate',()=>{
 for(const tagName of [null,undefined,123,{toString:()=> 'BUTTON'}]){
  assert.deepEqual(rankSelectorCandidates({
   method:'querySelector',oldSelector:'#old-button',
   nodes:[{tagName,attributes:{id:'safe-button'}}] as unknown as Parameters<typeof rankSelectorCandidates>[0]['nodes'],
  }),[],'non-string tag must not be ranked');
 }
});

test('plain JSON attribute budget rejects 33 keys and permits exactly 32',()=>{
 const attributes=Object.fromEntries(Array.from({length:32},(_,i)=>['extra-'+i,'text']));
 attributes.id='safe-button';
 assert.throws(()=>rankSelectorCandidates({method:'querySelector',oldSelector:'#old-button',
  nodes:[{tagName:'BUTTON',attributes}]}),/attribute|budget|limit/i);
 delete attributes['extra-31'];
 assert.equal(rankSelectorCandidates({method:'querySelector',oldSelector:'#old-button',
  nodes:[{tagName:'BUTTON',attributes}]}).length,1);
});

test('invalid tag data never invokes attacker-controlled coercion',()=>{
 let coerced=false;
 const tagName={toString(){coerced=true;throw new Error('coercion reached');}};
 assert.deepEqual(rankSelectorCandidates({method:'querySelector',oldSelector:'#old-button',
  nodes:[{tagName,attributes:{id:'safe-button'}}] as unknown as Parameters<typeof rankSelectorCandidates>[0]['nodes']}),[]);
 assert.equal(coerced,false);
});
