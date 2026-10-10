import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBatchRepairWorkflow} from '../src/batch.ts';

test('review covers every changed locator after the first 600 characters and pins source line/column/index',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-batch-review-'));
 try{
  const sourcePath=join(root,'later.user.js'),managedRoot=join(root,'Data');
  await mkdir(managedRoot);
  const source='// fixture source\n'+' '.repeat(2000)+'\n'+
   'document.querySelector("#old-repeat");\n'+
   'document.querySelector("#old-repeat");\n';
  await writeFile(sourcePath,source);
  const workflow=createBatchRepairWorkflow({managedRoot});
  const p=await workflow.proposeBatch({sourcePath,scriptId:'review-case',changes:[
   {oldSelector:'#old-repeat',newSelector:'#one',selectorLocation:{method:'querySelector',line:3,column:1}},
   {oldSelector:'#old-repeat',newSelector:'#two',selectorLocation:{method:'querySelector',line:4,column:1}},
  ]});
  assert.deepEqual(p.changes,[
   {selectorIndex:0,method:'querySelector',line:3,column:1,oldSelector:'#old-repeat',newSelector:'#one'},
   {selectorIndex:1,method:'querySelector',line:4,column:1,oldSelector:'#old-repeat',newSelector:'#two'},
  ]);
  assert.match(p.preview,/行\s*3.*#old-repeat.*#one/);
  assert.match(p.preview,/行\s*4.*#old-repeat.*#two/);
  assert.match(p.preview,/querySelector/);
  assert.doesNotMatch(p.preview,/ {1000}/,'review should not dump unrelated script source or huge whitespace');
  assert.equal(await readFile(sourcePath,'utf8'),source,'review must never change user original');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('renderer lists source position and all changes rather than trusting a truncated preview',async()=>{
 const c=await readFile(new URL('../../../apps/desktop/src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(c,/batchRepairProposal\.changes\.map/);
 assert.match(c,/x\.line/);
 assert.match(c,/x\.column/);
 assert.match(c,/x\.selectorIndex/);
 assert.match(c,/预览[\s\S]{0,1000}批准保存批量修复/);
});
