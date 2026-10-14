import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
 createSiteTestCase,listSiteTestCases,removeSiteTestCase,
 verifySiteTestCaseSelection,
} from '../src/site-test-cases.ts';

const meta={match:['https://example.invalid/app/*'],include:[],
 raw:{match:['https://example.invalid/app/*']}};
const scriptId='script-test-one';
async function temp(testCase:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-fr014-'));
 try{await testCase(root);}finally{await rm(root,{recursive:true,force:true});}
}
test('FR-014 saves two declared page states with explicit URLs and reloads them without browser execution',async()=>temp(async root=>{
 const first=await createSiteTestCase({dataRoot:root,scriptId,url:'https://example.invalid/app/dashboard',
  label:'Dashboard signed-out',stateId:'logged-out',metadata:meta});
 const second=await createSiteTestCase({dataRoot:root,scriptId,url:'https://example.invalid/app/editor',
  label:'Editor signed-in',stateId:'logged-in',metadata:meta});
 assert.notEqual(first.id,second.id);
 const saved=await listSiteTestCases({dataRoot:root,scriptId});
 assert.equal(saved.length,2);
 assert.deepEqual(saved.map(v=>[v.url,v.stateId]),[
  ['https://example.invalid/app/dashboard','logged-out'],
  ['https://example.invalid/app/editor','logged-in'],
 ]);
 assert.deepEqual(await listSiteTestCases({dataRoot:root,scriptId:'another-script'}),[]);
 const json=await readFile(join(root,'site-test-cases.json'),'utf8');
 assert.ok(json.includes('Dashboard signed-out'));
 assert.equal(json.includes('token='),false);
 assert.equal(saved.every(v=>Object.keys(v).sort().join(',')==='id,label,scriptId,stateId,url'),true);
 await assert.rejects(createSiteTestCase({dataRoot:root,scriptId,url:first.url,
  label:'Duplicate',stateId:first.stateId,metadata:meta}),/already|duplicate/i);
 await assert.rejects(removeSiteTestCase({dataRoot:root,scriptId,caseId:first.id,approved:false}),/approval/i);
 await assert.rejects(removeSiteTestCase({dataRoot:root,scriptId:'another-script',caseId:first.id,approved:true}),/not found/i);
 await removeSiteTestCase({dataRoot:root,scriptId,caseId:first.id,approved:true});
 assert.deepEqual((await listSiteTestCases({dataRoot:root,scriptId})).map(v=>v.id),[second.id]);
}));
test('FR-014 fail-closed scope and exact selected Chrome page matching never become V2/V3/V4 claims',async()=>temp(async root=>{
 const entry=await createSiteTestCase({dataRoot:root,scriptId,url:'https://example.invalid/app/dashboard',
  label:'Dashboard',stateId:'logged-out',metadata:meta});
 const same=verifySiteTestCaseSelection({entry,selectedUrl:'https://example.invalid/app/dashboard',metadata:meta});
 assert.equal(same.status,'matched');
 assert.equal(same.validationLevel,'configured-page-only');
 assert.equal(same.pageStateVerified,false);
 assert.equal(same.V2,'blocked');assert.equal(same.V3,'not-configured');assert.equal(same.V4,'not-configured');
 assert.equal(same.functionalVerified,false);
 for(const address of ['https://example.invalid/app/editor',
  'https://example.invalid/app/dashboard?token=PRIVATE_QUERY',
  'https://user:password@example.invalid/app/dashboard']){
  const observed=verifySiteTestCaseSelection({entry,selectedUrl:address,metadata:meta});
  assert.notEqual(observed.status,'matched');
  assert.equal(JSON.stringify(observed).includes('PRIVATE_QUERY'),false);
 }
 const changedMeta={match:['https://elsewhere.invalid/*'],include:[],
  raw:{match:['https://elsewhere.invalid/*']}};
 assert.equal(verifySiteTestCaseSelection({entry,selectedUrl:entry.url,metadata:changedMeta}).status,'scope-blocked');
}));
test('FR-014 refuses private queries, credentials, selectors and malformed stored registry without overwriting it',async()=>temp(async root=>{
 for(const address of ['javascript:alert(1)','file:///C:/secret','https://user:secret@example.invalid/app/x',
  'https://example.invalid/app/x?token=secret','https://example.invalid/app/x#sensitive',
  'https://example.invalid/everywhere','https://example.invalid/app/'+ 'a'.repeat(2100)]){
  await assert.rejects(createSiteTestCase({dataRoot:root,scriptId,url:address,
   label:'Case',stateId:'custom',metadata:meta}),/URL|scope|unsafe|budget|credential/i);
 }
 await assert.rejects(createSiteTestCase({dataRoot:root,scriptId,url:'https://example.invalid/app/x',
  label:'Wrong\nname',stateId:'custom',metadata:meta}),/label/i);
 await assert.rejects(access(join(root,'site-test-cases.json')),{code:'ENOENT'});
 const item=await createSiteTestCase({dataRoot:root,scriptId,url:'https://example.invalid/app/x',
  label:'Allowed case',stateId:'custom',metadata:meta});
 await writeFile(join(root,'site-test-cases.json'),'{CORRUPTED');
 await assert.rejects(listSiteTestCases({dataRoot:root,scriptId}),/corrupt|invalid/i);
 await assert.rejects(createSiteTestCase({dataRoot:root,scriptId,url:'https://example.invalid/app/y',
  label:'Must not overwrite',stateId:'custom',metadata:meta}),/corrupt|invalid/i);
 assert.equal(await readFile(join(root,'site-test-cases.json'),'utf8'),'{CORRUPTED');
 assert.ok(item.id);
}));
test('FR-014 real Electron product exposes case create/list/delete and explicit target verification',async()=>{
 const [main,preload,ui]=await Promise.all([
  readFile('apps/desktop/src/main/index.ts','utf8'),
  readFile('apps/desktop/src/preload/index.ts','utf8'),
  readFile('apps/desktop/src/renderer/App.tsx','utf8'),
 ]);
 for(const channel of ['site-test-case-create','site-test-case-list','site-test-case-remove','site-test-case-verify']){
  assert.match(main,new RegExp("ipcMain\\.handle\\('usshm:"+channel+"'"));
  assert.match(preload,new RegExp("ipcRenderer\\.invoke\\('usshm:"+channel+"'"));
 }
 assert.match(main,/checkUserscriptPageScope/);
 assert.match(main,/scanSessions\.require/);
 assert.match(main,/getVerifiedChromeStatus/);
 assert.match(ui,/保存测试页面场景/);
 assert.match(ui,/检查已选 Chrome 页面与场景/);
 assert.match(ui,/V2.*blocked|V2.*未验证/);
});

test('FR-014 rejects stale Chrome target-list URLs when the pinned document navigated',async()=>temp(async root=>{
 const entry=await createSiteTestCase({dataRoot:root,scriptId,
  url:'https://example.invalid/app/dashboard',label:'Pinned scenario',
  stateId:'custom',metadata:meta});
 // This must check two independent origins of truth: /json/list may be stale,
 // while CDP Page.getFrameTree identifies the actual current document.
 const verifyPinned=verifySiteTestCaseSelection as (input:
  Parameters<typeof verifySiteTestCaseSelection>[0]&{confirmedUrl:string}
 )=>ReturnType<typeof verifySiteTestCaseSelection>;
 const original=verifyPinned({
  entry,selectedUrl:entry.url,confirmedUrl:entry.url,metadata:meta,
 });
 assert.equal(original.status,'matched');
 const navigated=verifyPinned({
  entry,selectedUrl:entry.url,
  confirmedUrl:'https://example.invalid/app/another-page',metadata:meta,
 });
 assert.equal(navigated.status,'mismatch',
  'A stale CDP target list cannot certify a different live document as the saved scenario');
 const privateNavigation=verifyPinned({
  entry,selectedUrl:entry.url,
  confirmedUrl:'https://example.invalid/app/dashboard?token=PRIVATE',metadata:meta,
 });
 assert.equal(privateNavigation.status,'mismatch');
 assert.equal(JSON.stringify(privateNavigation).includes('PRIVATE'),false);
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 assert.match(main,/confirmedUrl:\s*before\.confirmedUrl/,
  'Electron Main must supply the real frame-confirmed URL, not only cached target metadata');
}));
