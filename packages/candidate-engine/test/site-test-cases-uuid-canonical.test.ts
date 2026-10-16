import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSiteTestCase,listSiteTestCases} from '../src/site-test-cases.ts';

const scriptId='scenario-uuid-review';
const uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const metadata={match:['https://example.invalid/app/*'],include:[],
 raw:{match:['https://example.invalid/app/*']}};
const record=(id:string,url:string)=>({
 id,scriptId,label:'Synthetic scenario',url,stateId:'custom',
});

test('FR-014 refuses noncanonical UUID aliases in persisted scenarios without overwriting the registry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-fr014-uuid-'));
 const path=join(root,'site-test-cases.json');
 try{
  const canonical={schemaVersion:1,cases:[record(uuid,'https://example.invalid/app/a')]};
  await writeFile(path,JSON.stringify(canonical)+'\n');
  assert.equal((await listSiteTestCases({dataRoot:root,scriptId})).length,1,
   'existing canonical lowercase generated UUIDs remain compatible');

  for(const cases of [
   [record(uuid.toUpperCase(),'https://example.invalid/app/a')],
   [record(uuid,'https://example.invalid/app/a'),
    record(uuid.toUpperCase(),'https://example.invalid/app/b')],
  ]){
   const bytes=JSON.stringify({schemaVersion:1,cases})+'\n';
   await writeFile(path,bytes);
   await assert.rejects(listSiteTestCases({dataRoot:root,scriptId}),
    /corrupt|invalid|duplicate|identity/i,
    'uppercase alias must not become a second indistinguishable scenario identity');
   await assert.rejects(createSiteTestCase({dataRoot:root,scriptId,
    url:'https://example.invalid/app/c',label:'Do not replace registry',
    stateId:'custom',metadata}),/corrupt|invalid|identity/i,
    'a write must fail closed on a noncanonical persisted UUID');
   assert.equal(await readFile(path,'utf8'),bytes,
    'invalid on-disk scenarios must remain untouched for explicit recovery');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
