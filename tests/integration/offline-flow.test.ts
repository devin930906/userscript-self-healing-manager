import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../packages/persistence/src/index.ts';
import {runStaticScan} from '../../packages/scan-service/src/index.ts';
import {serializeStaticReport} from '../../packages/reporting/src/index.ts';

test('end-to-end static analysis keeps userscript source bytes untouched',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-e2e-'));try{
 const file=join(dir,'测 试.user.js');const source='// ==UserScript==\r\n// @name Test\r\n// ==/UserScript==\r\nfunction q(){return document.querySelector(`#${userId}`)}\r\n';
 await writeFile(file,source);const before=createHash('sha256').update(await readFile(file)).digest('hex');
 const db=openDatabase(join(dir,'index.sqlite'));migrateDatabase(db);const repo=createScriptRepository(db);
 const batch=await runStaticScan({paths:[file],recursive:false,maxFiles:1000},{repository:repo});
 const text=serializeStaticReport(batch,'json');assert.equal(JSON.parse(text).items[0].runtimeRequiredCount,1);
 assert.equal(repo.list()[0]?.healthStatus,'runtime-required');assert.equal(batch.items[0]?.status,'parsed');db.close();
 const after=createHash('sha256').update(await readFile(file)).digest('hex');assert.equal(after,before);
 } finally {await rm(dir,{recursive:true,force:true});}
});
