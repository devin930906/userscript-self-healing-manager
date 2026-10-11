import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runStaticScan} from '../src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../persistence/src/index.ts';

/**
 * QA-010: real temp-file and real SQLite acceptance, not an adapter mock.
 * Deliberately includes malformed, unreadable, over-size, non-userscript and
 * duplicate items. No real userscripts, private files or browser data.
 */
test('QA-010 imports 50 mixed real files with per-file errors, exact counts and unchanged source bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-qa010-50files-'));
 let db:ReturnType<typeof openDatabase>|undefined;
 try{
  const healthy=Array.from({length:42},(_,i)=>join(root,`valid-${String(i+1).padStart(2,'0')}.user.js`));
  const malformed=Array.from({length:3},(_,i)=>join(root,`invalid-syntax-${i+1}.user.js`));
  const invalidEncoding=join(root,'invalid-utf8.user.js');
  const oversized=join(root,'oversize.user.js');
  const wrongExtension=join(root,'wrong-extension.js');
  const missing=join(root,'not-present.user.js');
  for(let i=0;i<healthy.length;i++){
   await writeFile(healthy[i]!,`document.querySelector("#item-${i+1}");\n`,'utf8');
  }
  for(const path of malformed)await writeFile(path,'const ( =;');
  await writeFile(invalidEncoding,Buffer.from([0xff,0xfe,0x00]));
  await writeFile(oversized,Buffer.alloc(513*1024,0x41));
  await writeFile(wrongExtension,'document.querySelector("#not-a-userscript");');
  const paths=[...healthy,...malformed,invalidEncoding,oversized,wrongExtension,healthy[0]!,missing];
  assert.equal(paths.length,50,'test must really exercise the 50-file requirement');
  const snapshots=await Promise.all([healthy[0]!,malformed[0]!,invalidEncoding,oversized,wrongExtension].map(p=>readFile(p)));
  db=openDatabase(':memory:');
  migrateDatabase(db);
  const registry=createScriptRepository(db);
  const scan=await runStaticScan({paths,recursive:false,maxFiles:50},{repository:registry});
  assert.equal(scan.scanMode,'static-only');
  assert.equal(scan.requestedCount,50);
  assert.equal(scan.enumeratedCount,50);
  assert.equal(scan.processedCount,50);
  assert.equal(scan.items.length,50);
  assert.deepEqual(scan.items.map(item=>item.path),paths,'every input retains its position');
  const expected=[...Array(42).fill('parsed'),...Array(4).fill('parse-error'),
   'skipped','skipped','skipped','unreadable'];
  assert.deepEqual(scan.items.map(item=>item.status),expected,'no invalid item may consume or hide another');
  assert.equal(scan.passedCount,42);
  assert.equal(scan.errorCount,5,'syntax/encoding failures and missing source count as errors');
  assert.equal(scan.items.filter(item=>item.status==='skipped').length,3);
  assert.equal(registry.list().length,46,'only readable .user.js inputs enter the registry');
  assert.equal(new Set(registry.list().map(item=>item.id)).size,46);
  assert.equal(scan.items[45]?.analysis?.encoding,'invalid');
  assert.match(scan.items[49]?.diagnostics.join(' ')??'',/ENOENT|not-present/i);
  assert.equal(scan.items[48]?.scriptId,undefined,'duplicate must not be registered twice');
  for(const [i,p] of [healthy[0]!,malformed[0]!,invalidEncoding,oversized,wrongExtension].entries())
   assert.deepEqual(await readFile(p),snapshots[i],'never mutate selected source or failed fixtures');
 }finally{
  try{db?.close();}finally{await rm(root,{recursive:true,force:true});}
 }
});
