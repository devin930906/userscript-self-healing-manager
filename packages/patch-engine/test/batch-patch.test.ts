import assert from 'node:assert/strict';
import {test} from 'node:test';
import {proposeLiteralPatchBatch} from '../src/index.ts';

const src='document.querySelector("#old");\ndocument.querySelector("#old");\ndocument.querySelector(".old-pane");\n';
const bytes=(s:string)=>Buffer.from(s,'utf8');
const entries=[
 {oldSelector:'#old',newSelector:'#first',selectorLocation:{method:'querySelector',line:1,column:1}},
 {oldSelector:'#old',newSelector:'#second',selectorLocation:{method:'querySelector',line:2,column:1}},
 {oldSelector:'.old-pane',newSelector:'.new-pane',selectorLocation:{method:'querySelector',line:3,column:1}},
];
test('batch selector draft changes precisely three AST calls in one byte-identical source, without touching original',()=>{
 const original=bytes(src),before=Buffer.from(original);
 const p=proposeLiteralPatchBatch({sourceBytes:original,changes:entries});
 assert.equal(p.changes.length,3);
 assert.equal(p.proposedSource,
  'document.querySelector("#first");\ndocument.querySelector("#second");\ndocument.querySelector(".new-pane");\n');
 assert.notEqual(p.baseHash,p.proposedHash);
 assert.match(p.baseHash,/^[a-f0-9]{64}$/);
 assert.match(p.proposedHash,/^[a-f0-9]{64}$/);
 assert.deepEqual(original,before,'batch draft is pure and cannot modify an original userscript');
});
test('batch editor preserves UTF-8 BOM and newline encoding without replacing text outside literal nodes',()=>{
 const src='\ufeffconst a=document.querySelector(\'#old\');\r\nconst b=document.querySelector(".old-pane");\r\n';
 const p=proposeLiteralPatchBatch({sourceBytes:bytes(src),changes:[
  {oldSelector:'#old',newSelector:'#next',selectorLocation:{method:'querySelector',line:1,column:9}},
  {oldSelector:'.old-pane',newSelector:'.next-pane',selectorLocation:{method:'querySelector',line:2,column:9}},
 ]});
 assert.ok(p.proposedSource.startsWith('\ufeff'));
 assert.match(p.proposedSource,/\r\n/);
 assert.equal(p.proposedSource.split('\r\n').length,3);
 assert.doesNotMatch(p.proposedSource,/#old|\.old-pane/);
});
test('duplicate, stale or incorrect AST source locations reject entire batch, not a partial patch',()=>{
 for(const input of [
  [entries[0]!,entries[0]!],
  [entries[0]!,{...entries[1]!,selectorLocation:{method:'querySelector',line:1,column:1}}],
  [entries[0]!,{...entries[1]!,oldSelector:'#not-old'}],
  [entries[0]!,{...entries[1]!,selectorLocation:{method:'querySelectorAll',line:2,column:1}}],
 ]){
  assert.throws(()=>proposeLiteralPatchBatch({sourceBytes:bytes(src),changes:input}),/duplicate|exactly one|selector|AST|match|position/i);
 }
});
test('rejects unbounded, empty, unchanged, malformed and dangerous patch proposals',()=>{
 const testCases=[
  [],Array(9).fill(entries[0]),
  [{...entries[0],newSelector:entries[0]!.oldSelector}],
  [{...entries[0],newSelector:'x'.repeat(1025)}],
  [{...entries[0],selectorLocation:{method:'querySelector',line:0,column:1}}],
 ];
 for(const changes of testCases)
  assert.throws(()=>proposeLiteralPatchBatch({sourceBytes:bytes(src),changes:changes as any}),/invalid|batch|limit|same|range|location|selector|maximum|unchanged/i);
 assert.throws(()=>proposeLiteralPatchBatch({sourceBytes:bytes('function broken('),changes:entries}),/syntax|parse|invalid/i);
 assert.throws(()=>proposeLiteralPatchBatch({sourceBytes:new Uint8Array([0xff,0xfe]),changes:entries}),/UTF-8|encoding|invalid/i);
});
test('source range pinning allows only the exact previously reviewed AST strings',()=>{
 const p=proposeLiteralPatchBatch({sourceBytes:bytes(src),changes:entries});
 const recheck=proposeLiteralPatchBatch({sourceBytes:bytes(src),changes:entries.map((e,i)=>({...e,expectedSourceRange:p.changes[i]!.sourceRange}))});
 assert.equal(recheck.proposedHash,p.proposedHash);
 assert.equal(recheck.proposedSource,p.proposedSource);
 const modified=entries.map((e,i)=>({...e,expectedSourceRange:i===1?{start:0,end:1}:p.changes[i]!.sourceRange}));
 assert.throws(()=>proposeLiteralPatchBatch({sourceBytes:bytes(src),changes:modified}),/exactly one|range|AST|match/i);
});
