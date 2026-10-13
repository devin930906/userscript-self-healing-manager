import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';

const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');

/** A genuine local SQLite backup and synthetic managed revision, never real Data. */
for(const scenario of [
 'managed-byte-mutation','sqlite-byte-mutation',
 'unexpected-managed-file','nested-manifest-mutation',
] as const){
 test('RG-06 complete core manifest must not publish after late '+scenario,async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-rg06-bundle-final-'));
  try{
   const dataRoot=join(root,'Data'),destination=join(root,'Recovery');
   await mkdir(dataRoot);
   const registry=openDatabase(join(dataRoot,'registry.sqlite'));
   migrateDatabase(registry);
   const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
   const bytes=Buffer.from('// ==UserScript==\n// @name Local Fixture\n// ==/UserScript==\n');
   const folder=join(dataRoot,'managed','fixture');
   await mkdir(folder,{recursive:true});
   await writeFile(join(folder,'original-'+sha(bytes)+'.user.js'),bytes);
   await writeFile(join(folder,'current.user.js'),bytes);
   const activeBytes=await readFile(join(folder,'current.user.js'));
   let injected=0;
   try{
    const beforeFinalManifest=async()=>{
     injected++;
     const managed=join(destination,'managed-recovery','managed','fixture');
     if(scenario==='managed-byte-mutation'){
      const changed=Buffer.from(bytes);
      changed[20]=changed[20]===65?66:65;
      assert.equal(changed.length,bytes.length);
      await writeFile(join(managed,'current.user.js'),changed);
     }else if(scenario==='sqlite-byte-mutation'){
      await writeFile(join(destination,'registry.sqlite'),'CORRUPT_SQLITE_BYTES');
     }else if(scenario==='unexpected-managed-file'){
      await writeFile(join(managed,'unlisted-staging.tmp'),'SYNTHETIC_UNLISTED');
     }else{
      const manifest=join(destination,'managed-recovery','manifest.json');
      const file=await readFile(manifest);
      const rewritten=Buffer.from(file);
      // Preserve length while breaking the verified nested manifest content.
      rewritten[20]=rewritten[20]===65?66:65;
      await writeFile(manifest,rewritten);
     }
    };
    await assert.rejects(createCoreRecoveryBundle({
     dataRoot,destination,registry,journal,beforeFinalManifest,
    } as Parameters<typeof createCoreRecoveryBundle>[0]),
    /recovery|snapshot|managed|archive|hash|manifest|sqlite|schema|integrity|mismatch|unexpected|unsafe/i,
    'the writer must refuse late changes BEFORE marking the entire backup complete');
    assert.equal(injected,1,'the test hook must fire after initial checks, before final manifest');
    await assert.rejects(access(join(destination,'manifest.json')),{code:'ENOENT'},
     'no complete:true manifest may survive a late staged snapshot mutation');
    assert.equal(registry.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
    assert.deepEqual(await readFile(join(folder,'current.user.js')),activeBytes,
     'the original managed Data source must remain byte-for-byte intact');
   }finally{journal.close();registry.close();}
  }finally{await rm(root,{recursive:true,force:true});}
 });
}
