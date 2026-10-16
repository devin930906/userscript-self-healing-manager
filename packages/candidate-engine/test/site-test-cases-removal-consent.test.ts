import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,access,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {createSiteTestCase,listSiteTestCases,removeSiteTestCase} from '../src/site-test-cases.ts';
import {ScanSessionCoordinator} from '../../scan-service/src/scan-session.ts';

const metadata={match:['https://example.invalid/app/*'],include:[],raw:{match:['https://example.invalid/app/*']}};
const scriptId='consented-removal';
async function fixture(run:(root:string,entry:Awaited<ReturnType<typeof createSiteTestCase>>)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-fr014-removal-'));
 try{
  const entry=await createSiteTestCase({dataRoot:root,scriptId,
   url:'https://example.invalid/app/original',label:'Confirmed',stateId:'custom',metadata});
  await run(root,entry);
 }finally{await rm(root,{recursive:true,force:true});}
}

for(const change of [
 {label:'Edited after native consent'},
 {url:'https://example.invalid/app/other'},
 {stateId:'logged-in'},
]){
 test(`FR-014 removal rejects a record whose ${Object.keys(change)[0]} changed after native confirmation`,async()=>fixture(async(root,entry)=>{
  const path=join(root,'site-test-cases.json');
  const stored=JSON.parse(await readFile(path,'utf8'));
  Object.assign(stored.cases[0],change);
  const edited=JSON.stringify(stored)+'\n';await writeFile(path,edited);
  await assert.rejects(removeSiteTestCase({dataRoot:root,scriptId,caseId:entry.id,
   approved:true,expected:entry} as Parameters<typeof removeSiteTestCase>[0]),
   /consent|changed|expected|stale/i,'old native consent must not delete an independently edited record');
  assert.equal(await readFile(path,'utf8'),edited);
  await assert.rejects(access(path+'.write-lock'),{code:'ENOENT'});
 }));
}

test('FR-014 removal refuses a boolean approval without an exact native-confirmed record',async()=>fixture(async(root,entry)=>{
 const path=join(root,'site-test-cases.json');const before=await readFile(path);
 await assert.rejects(removeSiteTestCase({dataRoot:root,scriptId,caseId:entry.id,approved:true} as Parameters<typeof removeSiteTestCase>[0]),
  /consent|expected|record/i);
 assert.deepEqual(await readFile(path),before);
}));

test('FR-014 removal rechecks trusted authorization at the persistence boundary',async()=>fixture(async(root,entry)=>{
 const path=join(root,'site-test-cases.json');const before=await readFile(path);
 let rechecks=0;
 await assert.rejects(removeSiteTestCase({dataRoot:root,scriptId,caseId:entry.id,
  approved:true,expected:entry,beforeFinalWrite:async()=>{
   rechecks++;
   throw new Error('Trusted scan/source authorization revoked during removal I/O');
  }} as Parameters<typeof removeSiteTestCase>[0]),/revoked/);
 assert.equal(rechecks,1);
 assert.deepEqual(await readFile(path),before);
 assert.deepEqual((await listSiteTestCases({dataRoot:root,scriptId})).map(c=>c.id),[entry.id]);
 assert.deepEqual(await readdir(root),['site-test-cases.json']);
}));

test('FR-014 unchanged native-confirmed removal commits after its final authorization recheck',async()=>fixture(async(root,entry)=>{
 let rechecks=0;
 await removeSiteTestCase({dataRoot:root,scriptId,caseId:entry.id,
  approved:true,expected:entry,beforeFinalWrite:async()=>{rechecks++;}} as Parameters<typeof removeSiteTestCase>[0]);
 assert.equal(rechecks,1);
 assert.deepEqual(await listSiteTestCases({dataRoot:root,scriptId}),[]);
}));

test('FR-014 final synchronous removal authorization runs after all awaited persistence reads',async()=>fixture(async(root,entry)=>{
 const path=join(root,'site-test-cases.json');const before=await readFile(path);
 let authorized=true,finalChecks=0;
 await assert.rejects(removeSiteTestCase({dataRoot:root,scriptId,caseId:entry.id,
  approved:true,expected:entry,
  beforeFinalWrite:async()=>{
   assert.equal(authorized,true,'early authorization was still valid');
   // Deterministic event-loop revocation as the operation yields for its
   // final registry/staging reads; no timers or scheduler-sensitive sleeps.
   queueMicrotask(()=>{authorized=false;});
  },
  assertAuthorized:()=>{finalChecks++;if(!authorized)throw new Error('Final removal consent revoked');},
 } as Parameters<typeof removeSiteTestCase>[0]),/revoked/);
 assert.equal(finalChecks,1);
 assert.deepEqual(await readFile(path),before);
}));

test('FR-014 real scan replacement during final removal I/O preserves the consented registry',async()=>fixture(async(root,entry)=>{
 const path=join(root,'site-test-cases.json'),before=await readFile(path);
 const scans=new ScanSessionCoordinator<{revision:number}>();
 const confirmed=await scans.replace(async()=>({revision:1}));
 let replaced:Promise<unknown>=Promise.resolve();
 await assert.rejects(removeSiteTestCase({dataRoot:root,scriptId,caseId:entry.id,
  approved:true,expected:entry,
  beforeFinalWrite:async()=>{
   scans.assertCurrent(confirmed);
   replaced=new Promise((resolve,reject)=>setImmediate(()=>{
    scans.replace(async()=>({revision:2})).then(resolve,reject);
   }));
  },
  assertAuthorized:()=>scans.assertCurrent(confirmed),
 }),/stale|scan|in progress/i);
 await replaced;
 assert.throws(()=>scans.assertCurrent(confirmed),/stale|scan/i);
 assert.deepEqual(await readFile(path),before);
 assert.deepEqual(await readdir(root),['site-test-cases.json']);
}));
