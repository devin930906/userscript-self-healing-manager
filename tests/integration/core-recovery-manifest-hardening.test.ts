import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle,verifyCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';

async function withCoreBundle(check:(directory:string)=>Promise<void>):Promise<void>{
 const tmp=await mkdtemp(join(tmpdir(),'usshm-core-manifest-hardening-'));
 try{
  const dataRoot=join(tmp,'Data'),directory=join(tmp,'Core-Backup');
  await mkdir(dataRoot);
  const registry=openDatabase(join(dataRoot,'registry.sqlite'));
  migrateDatabase(registry);
  const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
  try{
   await createCoreRecoveryBundle({dataRoot,destination:directory,registry,journal});
   await check(directory);
  }finally{journal.close();registry.close();}
 }finally{await rm(tmp,{recursive:true,force:true});}
}

test('core recovery verifier rejects a false claim that browser secrets are in the backup scope',async()=>{
 await withCoreBundle(async directory=>{
  const manifestPath=join(directory,'manifest.json');
  const doc=JSON.parse(await readFile(manifestPath,'utf8')) as Record<string,unknown>;
  assert.equal(doc.scope,'registry+journal+managed-revisions-only');
  doc.scope='registry+journal+managed-revisions+browser-profiles+secrets';
  await writeFile(manifestPath,JSON.stringify(doc,null,2)+'\n');
  await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:directory}),/scope|manifest/i);
 });
});

test('core recovery verifier rejects malformed UTF-8, not a lossy replacement character',async()=>{
 await withCoreBundle(async directory=>{
  const manifestPath=join(directory,'manifest.json');
  const original=await readFile(manifestPath);
  const mark=Buffer.from('  "scope": "registry+journal+managed-revisions-only",');
  const at=original.indexOf(mark);
  assert.notEqual(at,-1,'stable manifest scope line is required');
  // An invalid UTF-8 string previously became U+FFFD through Buffer.toString().
  // The resulting JSON was syntactically valid and accepted as complete.
  const corrupt=Buffer.concat([
   original.subarray(0,at),Buffer.from('  "note": "'),
   Buffer.from([0xff]),Buffer.from('",\n'),original.subarray(at)
  ]);
  await writeFile(manifestPath,corrupt);
  await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:directory}),/UTF-8|manifest/i);
 });
});
