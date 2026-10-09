import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSiteAdapterLibrary} from '../src/site-adapter-library.ts';

const valid=()=>({
 schemaVersion:1,siteId:'example-app',version:'1.0.0',urlPatterns:['https://example.org/app/*'],
 states:{ready:{description:'Page ready'}},
 roles:{'chat.sendButton':{
  contexts:[{stateId:'ready',frame:'top',shadow:'none'}],
  strategies:[{kind:'css',selector:'[data-testid="send-button"]',weight:100}],
  cardinality:{min:1,max:1},assertions:['unique'],
 }},
 validationCases:['SEND_EXISTS'],
});
async function fixture<T>(fn:(dataRoot:string,source:string)=>Promise<T>){
 const root=await mkdtemp(join(tmpdir(),'usshm-adapter-lib-'));
 const dataRoot=join(root,'Data'),source=join(root,'selected-adapter.json');
 await mkdir(dataRoot);await writeFile(source,JSON.stringify(valid()));
 try{return await fn(dataRoot,source);}finally{await rm(root,{force:true,recursive:true});}
}
test('file-picker sourced SiteAdapter stays preview-only before explicit second approval',async()=>fixture(async(dataRoot,source)=>{
 const lib=createSiteAdapterLibrary({dataRoot});
 const preview=await lib.previewImport({sourcePath:source});
 assert.equal(preview.siteId,'example-app');assert.equal(preview.version,'1.0.0');
 assert.equal(preview.roleCount,1);assert.equal(preview.stateCount,1);
 assert.equal(preview.urlPatterns.length,1);
 assert.match(preview.previewId,/^[0-9a-f-]{36}$/i);
 assert.deepEqual(await lib.list(),[]);
 await assert.rejects(lib.approveImport({previewId:preview.previewId,approved:false}),/approval/i);
 assert.deepEqual(await lib.list(),[]);
 const applied=await lib.approveImport({previewId:preview.previewId,approved:true});
 assert.equal(applied.siteId,'example-app');
 assert.equal(applied.version,'1.0.0');
 assert.deepEqual((await lib.list()).map(x=>x.siteId),['example-app']);
 const loaded=createSiteAdapterLibrary({dataRoot});
 assert.equal((await loaded.list())[0]?.version,'1.0.0');
 const expected=JSON.parse(await readFile(join(dataRoot,'site-adapters','example-app.json'),'utf8'));
 assert.equal(expected.roles['chat.sendButton'].strategies[0].selector,'[data-testid="send-button"]');
 await assert.rejects(lib.approveImport({previewId:preview.previewId,approved:true}),/expired|not found/i);
}));
test('staged import refuses modified source bytes and stale site overwrite',async()=>fixture(async(dataRoot,source)=>{
 const lib=createSiteAdapterLibrary({dataRoot});
 const preview=await lib.previewImport({sourcePath:source});
 const modified={...valid(),version:'2.0.0'};
 await writeFile(source,JSON.stringify(modified));
 await assert.rejects(lib.approveImport({previewId:preview.previewId,approved:true}),/changed|hash|stale/i);
 assert.deepEqual(await lib.list(),[]);
 await writeFile(source,JSON.stringify(valid()));
 const initial=await lib.previewImport({sourcePath:source});
 const simultaneous=await lib.previewImport({sourcePath:source});
 await lib.approveImport({previewId:initial.previewId,approved:true});
 await assert.rejects(lib.approveImport({previewId:simultaneous.previewId,approved:true}),/exists|already|upgrade|stale/i);
 await assert.rejects(lib.previewImport({sourcePath:source}),/exists|already|upgrade/i);
 assert.equal((await lib.list()).length,1);
}));
test('rejects large, malformed, symlinked or unsupported adapter JSON without writing stored adapter',async()=>fixture(async(dataRoot,source)=>{
 const lib=createSiteAdapterLibrary({dataRoot});
 await writeFile(source,'x'.repeat(65537));
 await assert.rejects(lib.previewImport({sourcePath:source}),/size|large|limit/i);
 await writeFile(source,'{"invalid":');
 await assert.rejects(lib.previewImport({sourcePath:source}),/JSON|invalid|parse/i);
 await writeFile(source,JSON.stringify({...valid(),schemaVersion:44}));
 await assert.rejects(lib.previewImport({sourcePath:source}),/schema|version/i);
 const link=join(dataRoot,'selected-link.json');
 try{
  await symlink(source,link,'file');
  await assert.rejects(lib.previewImport({sourcePath:link}),/symlink|regular/i);
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=='EPERM'&&(error as NodeJS.ErrnoException).code!=='EACCES')throw error;
 }
 assert.deepEqual(await lib.list(),[]);
}));
test('adapted local library rejects nonregular stored files and symlinked storage root',async()=>fixture(async(dataRoot,source)=>{
 const lib=createSiteAdapterLibrary({dataRoot});
 const result=await lib.previewImport({sourcePath:source});
 await lib.approveImport({previewId:result.previewId,approved:true});
 const target=join(dataRoot,'site-adapters','example-app.json');
 await rm(target);
 await mkdir(target);
 await assert.rejects(lib.list(),/regular|file|unsafe/i);
}));
test('library refuses untrusted ids, paths, and incorrect approval objects',async()=>fixture(async(dataRoot,source)=>{
 const lib=createSiteAdapterLibrary({dataRoot});
 await assert.rejects(lib.previewImport({sourcePath:'../selected-adapter.json'}),/absolute|path/i);
 await assert.rejects(lib.approveImport({previewId:'../foo',approved:true}),/invalid|expired|not found/i);
 assert.deepEqual(await lib.list(),[]);
}));
