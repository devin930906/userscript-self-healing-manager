import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {access,link,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {exportManagedRecovery,verifyManagedRecovery} from '../../packages/repair-workflow/src/managed-export.ts';

const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
async function fixture(run:(v:{
 root:string;source:string;target:string;data:Buffer;
})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-rg06-managed-last-'));
 try{
  const source=join(root,'Data'),managed=join(source,'managed','script-one');
  const target=join(root,'Managed-Recovery');
  await mkdir(managed,{recursive:true});
  const data=Buffer.from('// ==UserScript==\n// @name Synthetic Managed Export\n// ==/UserScript==\n');
  await writeFile(join(managed,'original-'+sha(data)+'.user.js'),data);
  await writeFile(join(managed,'current.user.js'),data);
  await run({root,source,target,data});
 }finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06 ordinary managed export remains independently verifiable',async()=>fixture(async({source,target})=>{
 const exported=await exportManagedRecovery({managedRoot:source,destination:target});
 assert.equal(exported.files.length,2);
 assert.deepEqual(await verifyManagedRecovery({snapshotDirectory:target}),{
  files:2,bytes:exported.files.reduce((sum,f)=>sum+f.bytes,0),
 });
}));

for(const scenario of ['same-size-rewrite','unexpected-file','external-hardlink'] as const){
 test('RG-06 incomplete managed export must never be marked complete after late '+scenario,async()=>
  fixture(async({root,source,target,data})=>{
   const original=await readFile(join(source,'managed','script-one','current.user.js'));
   let faultCalls=0;
   const beforeFinalManifest=async()=>{
    faultCalls++;
    const staged=join(target,'managed','script-one','current.user.js');
    if(scenario==='same-size-rewrite'){
     const edited=Buffer.from(data);
     edited[20]=edited[20]===65?66:65;
     assert.equal(edited.length,data.length);
     await writeFile(staged,edited);
    }else if(scenario==='unexpected-file'){
     await writeFile(join(target,'managed','script-one','unlisted.part'),'UNLISTED_SYNTHETIC');
    }else{
     await link(staged,join(root,'external-managed-alias.user.js'));
    }
   };
   await assert.rejects(
    exportManagedRecovery({managedRoot:source,destination:target,beforeFinalManifest}),
    /managed|recovery|hash|unsafe|alias|unexpected|inventory|mismatch|changed/i,
    'the final manifest must only be published after all staged bytes and inventory are rechecked',
   );
   assert.equal(faultCalls,1,'run fault injection only after copied files have been individually verified');
   await assert.rejects(access(join(target,'manifest.json')),{code:'ENOENT'},
    'incomplete backup must never include complete:true manifest');
   assert.deepEqual(await readFile(join(source,'managed','script-one','current.user.js')),original,
    'the active original managed source must remain unchanged');
  })
 );
}
