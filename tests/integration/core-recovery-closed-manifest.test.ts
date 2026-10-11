import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,migrateDatabase} from '../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../packages/job-journal/src/index.ts';
import {createCoreRecoveryBundle,verifyCoreRecoveryBundle} from '../../packages/repair-workflow/src/core-recovery.ts';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

async function withSnapshot(verify:(root:string)=>Promise<void>):Promise<void>{
 const tmp=await mkdtemp(join(tmpdir(),'usshm-closed-manifest-'));
 try{
  const dataRoot=join(tmp,'Data'),root=join(tmp,'Recovery');
  await mkdir(dataRoot);
  const script=Buffer.from('// ==UserScript==\n// @name Local Test\n// ==/UserScript==\n');
  const managed=join(dataRoot,'managed','test');
  await mkdir(managed,{recursive:true});
  await writeFile(join(managed,'original-'+sha(script)+'.user.js'),script);
  await writeFile(join(managed,'current.user.js'),script);
  const registry=openDatabase(join(dataRoot,'registry.sqlite'));
  migrateDatabase(registry);
  const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
  try{
   await createCoreRecoveryBundle({dataRoot,destination:root,registry,journal});
   assert.deepEqual(await verifyCoreRecoveryBundle({snapshotDirectory:root}),{valid:true,files:3});
   await verify(root);
  }finally{journal.close();registry.close();}
 }finally{await rm(tmp,{recursive:true,force:true});}
}
async function rewrite(root:string,edit:(core:any,managed:any)=>void){
 const manifest=join(root,'manifest.json');
 const managedFile=join(root,'managed-recovery','manifest.json');
 const core=JSON.parse(await readFile(manifest,'utf8'));
 const nested=JSON.parse(await readFile(managedFile,'utf8'));
 edit(core,nested);
 const bytes=Buffer.from(JSON.stringify(nested,null,2)+'\n');
 await writeFile(managedFile,bytes);
 core.files[2].sha256=sha(bytes);
 core.files[2].bytes=bytes.length;
 await writeFile(manifest,JSON.stringify(core,null,2)+'\n');
}
for(const scenario of [
 {name:'core top-level fake secrets claim',edit:(core:any)=>{core.browserSecretsIncluded=true;}},
 {name:'core file entry fake restore indicator',edit:(core:any)=>{core.files[0].restoredSuccessfully=true;}},
 {name:'managed top-level fake browser-profile claim',edit:(_core:any,managed:any)=>{managed.browserProfilesIncluded=true;}},
 {name:'managed revision entry fake execution confirmation',edit:(_core:any,managed:any)=>{managed.files[0].scriptExecuted=true;}},
]){
 test('offline recovery rejects unknown signed-off fields: '+scenario.name,async()=>withSnapshot(async root=>{
  await rewrite(root,scenario.edit);
  await assert.rejects(verifyCoreRecoveryBundle({snapshotDirectory:root}),
   /manifest|unexpected|invalid|unknown|field/i,
   'unrecognized backup claims must never be displayed as a verified recovery package');
 }));
}
