import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSiteTestCase,listSiteTestCases} from '../src/site-test-cases.ts';

const metadata={match:['https://example.invalid/app/*'],include:[],
 raw:{match:['https://example.invalid/app/*']}};
const scriptId='scenario-publish-cas';

test('FR-014 refuses a valid external registry change after the first pre-publish identity check',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-fr014-final-check-'));
 const target=join(root,'site-test-cases.json');
 try{
  const original=await createSiteTestCase({dataRoot:root,scriptId,
   url:'https://example.invalid/app/a',label:'Initial record',
   stateId:'custom',metadata});
  let externalBytes='';
  let changed=0;
  await assert.rejects(createSiteTestCase({dataRoot:root,scriptId,
   url:'https://example.invalid/app/b',label:'Second record',
   stateId:'custom',metadata,
   // This test-only hook executes AFTER the existing optimistic identity check.
   beforePublish:async()=>{
    changed++;
    const current=JSON.parse(await readFile(target,'utf8'));
    current.cases[0].label='External confirmed edit';
    externalBytes=JSON.stringify(current)+'\n';
    await writeFile(target,externalBytes);
   },
  }),/changed|concurren|stale|conflict/i,
  'post-check external writer must not be silently overwritten');
  assert.equal(changed,1);
  assert.equal(await readFile(target,'utf8'),externalBytes,
   'the external writer must retain ownership of its valid committed edit');
  const saved=await listSiteTestCases({dataRoot:root,scriptId});
  assert.deepEqual(saved.map(c=>[c.id,c.label]),[[original.id,'External confirmed edit']]);
 }finally{await rm(root,{recursive:true,force:true});}
});
