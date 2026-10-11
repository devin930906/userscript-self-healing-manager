import assert from 'node:assert/strict';
import {test} from 'node:test';
import {proposeLiteralPatch} from '../src/index.ts';

test('a reviewed single-selector patch must make a genuine change, not mint a no-op revision',()=>{
 const source=Buffer.from('document.querySelector("#old-selector");\n');
 assert.throws(()=>proposeLiteralPatch({
  sourceBytes:source,oldSelector:'#old-selector',newSelector:'#old-selector',
 }),/same|unchanged|no.op|different/i);
});
