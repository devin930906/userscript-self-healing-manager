import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSiteTestCase,listSiteTestCases} from '../src/site-test-cases.ts';

const metadata={match:['https://example.invalid/app/*'],include:[],raw:{match:['https://example.invalid/app/*']}};
const scriptId='scenario-review';
async function withRoot(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-site-lost-update-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}

test('FR-014 P0 prevents silently overwriting an externally changed valid scenario registry',async()=>withRoot(async root=>{
 const original=await createSiteTestCase({dataRoot:root,scriptId,
  url:'https://example.invalid/app/a',label:'Original',stateId:'custom',metadata});
 const path=join(root,'site-test-cases.json');
 let injected=0;
 await assert.rejects(createSiteTestCase({dataRoot:root,scriptId,
  url:'https://example.invalid/app/b',label:'New entry',stateId:'custom',metadata,
  // Test-only fault injection between temporary write and final rename.
  beforeFinalWrite:async()=>{
   injected++;
   const external=JSON.parse(await readFile(path,'utf8'));
   external.cases[0].label='Externally updated';
   await writeFile(path,JSON.stringify(external)+'\n');
  },
 }),/concurren|changed|conflict|stale/i);
 assert.equal(injected,1,'the concurrent mutation was actually executed at the commit boundary');
 const saved=await listSiteTestCases({dataRoot:root,scriptId});
 assert.deepEqual(saved.map(x=>[x.id,x.label]),[[original.id,'Externally updated']]);
 const files=await readFile(path,'utf8');
 assert.equal(files.includes('New entry'),false,'disputed write must not overwrite the other writer');
 await assert.rejects(access(join(root,'site-test-cases.json.write-lock')),{code:'ENOENT'});
}));
test('FR-014 P0 refuses an external first registry created while an initially missing one is being committed',async()=>withRoot(async root=>{
 const path=join(root,'site-test-cases.json');
 let callbackRan=0;
 await assert.rejects(createSiteTestCase({dataRoot:root,scriptId,
  url:'https://example.invalid/app/a',label:'First local',stateId:'logged-out',metadata,
  beforeFinalWrite:async()=>{
   callbackRan++;
   await writeFile(path,JSON.stringify({schemaVersion:1,cases:[]})+'\n',{flag:'wx'});
  },
 }),/concurren|changed|conflict|stale/i);
 assert.equal(callbackRan,1);
 assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{schemaVersion:1,cases:[]});
 assert.deepEqual(await listSiteTestCases({dataRoot:root,scriptId}),[]);
}));

test('FR-014 P0 aborts a precommit save when trusted scan authorization is revoked',async()=>withRoot(async root=>{
 const initial=await createSiteTestCase({dataRoot:root,scriptId,
  url:'https://example.invalid/app/initial',label:'Saved before revocation',stateId:'custom',metadata});
 const path=join(root,'site-test-cases.json');
 const savedBefore=await readFile(path,'utf8');
 let revoked=0;
 await assert.rejects(createSiteTestCase({dataRoot:root,scriptId,
  url:'https://example.invalid/app/unauthorized',label:'Must not persist',stateId:'custom',metadata,
  beforeFinalWrite:async()=>{revoked++;throw new Error('Trusted scan session was revoked');},
 }),/revoked/);
 assert.equal(revoked,1,'revocation happened inside the real pre-rename filesystem gate');
 assert.equal(await readFile(path,'utf8'),savedBefore,'revocation cannot mutate committed scenarios');
 assert.deepEqual((await listSiteTestCases({dataRoot:root,scriptId})).map(x=>x.id),[initial.id]);
 await assert.rejects(access(path+'.write-lock'),{code:'ENOENT'});
}));

test('FR-014 P0 never clobbers an independently created first registry when a new file is published after the last identity check',async()=>withRoot(async root=>{
 const target=join(root,'site-test-cases.json');
 const external=JSON.stringify({schemaVersion:1,cases:[]})+'\n';
 let happened=0;
 // The extra callback is internal deterministic fault injection, not an
 // Electron IPC field. It must run AFTER the final prior-identity recheck.
 const params:Parameters<typeof createSiteTestCase>[0]&{beforePublish:()=>Promise<void>}={
  dataRoot:root,scriptId,url:'https://example.invalid/app/first-save',
  label:'First local entry',stateId:'logged-out',metadata,
  beforePublish:async()=>{
   happened++;
   await writeFile(target,external,{flag:'wx',mode:0o600});
  },
 };
 await assert.rejects(createSiteTestCase(params),/exists|conflict|concurren|changed|refus|publish/i,
  'initial registry creation must be an OS-level no-replace publish');
 assert.equal(happened,1,'test must inject the independent writer after the final read');
 assert.equal(await readFile(target,'utf8'),external,
  'an independently written first registry must not be overwritten');
 assert.deepEqual(await listSiteTestCases({dataRoot:root,scriptId}),[]);
 await assert.rejects(access(target+'.write-lock'),{code:'ENOENT'},
  'the failed write must release the cooperating app lease');
}));
