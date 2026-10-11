import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runStaticScan} from '../src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository,type DatabaseHandle} from '../../persistence/src/index.ts';

type FixtureDb={close():void};
async function withScanFixture<T extends FixtureDb = DatabaseHandle>(options:{
 open?:()=>T;
 remove?:(root:string)=>Promise<void>;
},run:(root:string,db:T)=>Promise<void>):Promise<void>{
 const root=await mkdtemp(join(tmpdir(),'usshm-task7-batch-'));
 const errors:unknown[]=[];
 let db:T|undefined;
 try{
  db=(options.open??(()=>openDatabase(':memory:') as unknown as T))();
  await run(root,db);
 }catch(error){errors.push(error);}
 if(db){try{db.close();}catch(error){errors.push(error);}}
 try{await (options.remove??(path=>rm(path,{recursive:true,force:true})))(root);}
 catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];
 if(errors.length>1)throw new AggregateError(errors,'Scan fixture and cleanup failed');
}

test('Task 7 batch: duplicate input is skipped, unreadable and parse failures are isolated, counters match every item',async()=>{
 await withScanFixture({},async(root,db)=>{
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
  assert.equal(repository.list().length,3,'duplicate and unreadable items must not create records; parse-error remains recorded');
  assert.deepEqual(repository.list().map(record=>record.path).sort(),[first,invalid,last].sort());
  for(const [index,path] of [first,invalid,last].entries())assert.deepEqual(await readFile(path),before[index]);
 });
});

test('fixture cleanup removes its own root after database open fails',async()=>{
 const opened=new Error('fixture open failed');
 let removed=false;
 await assert.rejects(withScanFixture({
  open:()=>{throw opened;},
  remove:async root=>{assert.match(root,/usshm-task7-batch-/);await rm(root,{recursive:true,force:true});removed=true;},
 },async()=>{}),error=>{assert.equal(error,opened);return true;});
 assert.equal(removed,true);
});

test('fixture cleanup attempts removal despite close failure, keeping the test failure first',async()=>{
 const primary=new Error('primary scan assertion failed');
 const closing=new Error('fixture close failed');
 const removal=new Error('fixture remove failed');
 const events:string[]=[];
 await assert.rejects(withScanFixture({
  open:()=>({close:()=>{events.push('close');throw closing;}}),
  remove:async root=>{events.push('remove');await rm(root,{recursive:true,force:true});throw removal;},
 },async()=>{throw primary;}),error=>{
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(error.errors,[primary,closing,removal]);
  return true;
 });
 assert.deepEqual(events,['close','remove']);
});
