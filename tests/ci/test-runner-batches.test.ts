import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildTestBatches,assertTestSourceBudget} from '../../scripts/test-batches.mjs';

test('CI Windows runner batches hundreds of long paths below the process command-line limit',()=>{
 const files=Array.from({length:280},(_,index)=>
  'D:\\a\\userscript-self-healing-manager\\userscript-self-healing-manager\\packages\\'+
  ('test-module-'+index.toString().padStart(3,'0')+'\\')+
  'very-long-synthetic-test-directory-name\\regression.test.ts');
 assert.ok(files.reduce((sum,file)=>sum+file.length+3,0)>32767,
  'fixture must exceed the Windows command-line cap if launched in one command');
 const batches=buildTestBatches(files);
 assert.ok(batches.length>1,'runner must never send all paths in a single subprocess');
 assert.deepEqual(batches.flat(),files,'no tests may be skipped or reordered');
 for(const group of batches){
  assert.ok(group.length>0&&group.length<=48);
  assert.ok(group.reduce((sum,file)=>sum+file.length+3,0)<=12000,
   'leave substantial room under Windows CreateProcess command-line limit');
 }
});

test('CI batching rejects invalid entries instead of silently omitting them',()=>{
 for(const bad of [[''],['regular.test.ts',null],['a'.repeat(12001)]]){
  assert.throws(()=>buildTestBatches(bad as string[]),/invalid|exceeds|length|path|budget/i);
 }
 assert.throws(()=>buildTestBatches([]),/empty|no tests|invalid/i);
});

test('CI rejects oversized, nonregular and invalid test-source metadata',()=>{
 assert.equal(assertTestSourceBudget({size:128*1024,isFile:true}),true);
 for(const candidate of [{size:128*1024+1,isFile:true},{size:-1,isFile:true},{size:Infinity,isFile:true},{size:0,isFile:false}])
  assert.throws(()=>assertTestSourceBudget(candidate),/budget|source/i);
});
