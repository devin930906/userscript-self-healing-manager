import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runStaticScan} from '../src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../persistence/src/index.ts';

test('Task 7 batch: duplicate input is skipped, unreadable and parse failures are isolated, counters match every item',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-task7-batch-'));
 const db=openDatabase(':memory:');
 try{
  migrateDatabase(db);
  const first=join(root,'first.user.js');
  const absent=join(root,'missing.user.js');
  const invalid=join(root,'invalid.user.js');
  const last=join(root,'last.user.js');
  await writeFile(first,'document.querySelector("#first");');
  await writeFile(invalid,'const (=');
  await writeFile(last,'document.querySelector("#last");');
  const before=await Promise.all([first,invalid,last].map(path=>readFile(path)));
  const repository=createScriptRepository(db);
  const inputs=[first,first,absent,invalid,last];
  const result=await runStaticScan({paths:inputs,recursive:false,maxFiles:5},{repository});
  assert.equal(result.scanMode,'static-only');
  assert.equal(result.requestedCount,inputs.length);
  assert.equal(result.enumeratedCount,5);
  assert.equal(result.processedCount,result.items.length);
  assert.deepEqual(result.items.map(item=>item.path),inputs,'results preserve selected input order');
  assert.deepEqual(result.items.map(item=>item.status),['parsed','skipped','unreadable','parse-error','parsed']);
  assert.equal(result.passedCount,result.items.filter(item=>item.status==='parsed').length);
  assert.equal(result.errorCount,result.items.filter(item=>item.status==='parse-error'||item.status==='unreadable').length);
  assert.equal(result.passedCount,2);
  assert.equal(result.errorCount,2);
  assert.equal(result.items[1]?.scriptId,undefined);
  assert.equal(result.items[1]?.analysis,undefined);
  assert.equal(result.items[2]?.scriptId,undefined);
  assert.ok(result.items[2]?.diagnostics.length,'missing script must retain failure diagnostics');
  assert.ok(result.items[3]?.diagnostics.length,'parse failure must retain diagnostics');
  assert.equal(repository.list().length,2,'duplicate and failed items must not create records');
  assert.deepEqual(repository.list().map(record=>record.path).sort(),[first,last].sort());
  for(const [index,path] of [first,invalid,last].entries())assert.deepEqual(await readFile(path),before[index]);
 }finally{
  db.close();
  await rm(root,{recursive:true,force:true});
 }
});
