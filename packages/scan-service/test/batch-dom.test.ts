import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diagnoseScriptsOnPage} from '../src/batch-dom.ts';

const meta=(match:string[])=>({match,include:[],raw:{}});
const analysis=(m=meta(['https://example.org/*']),records:any[]=[
 {method:'querySelector',expression:'#missing',runtimeRequired:false,receiver:'document'},
])=>({metadata:m,selectorRecords:records});
const items:any[]=[
 {path:'one.user.js',scriptId:'one',status:'parsed',analysis:analysis()},
 {path:'two.user.js',scriptId:'two',status:'parsed',analysis:analysis(meta(['https://other.example/*']))},
 {path:'three.user.js',scriptId:'three',status:'parsed',analysis:analysis(meta(['https://example.org/*']),[{method:'querySelector',expression:'#dynamic',runtimeRequired:true,receiver:'document'}])},
 {path:'broken.user.js',status:'parse-error',diagnostics:['Invalid expression']},
];
const page={type:'page',id:'p1',url:'https://example.org/page',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/p1'};

test('batch uses metadata page scope and never probes out-of-scope or invalid scripts',async()=>{
 const called:string[]=[];let identities=0;
 const result=await diagnoseScriptsOnPage({items,target:page,consent:true,deps:{
  confirm:async()=>{identities++;return {targetId:page.id,confirmedUrl:page.url};},
  probe:async(_target,locators)=>{called.push(locators[0]?.expression??'');return {targetId:page.id,url:page.url,validationLevel:'dom-only',checks:locators.map(x=>({method:x.method,expression:x.expression,status:'missing',matchCount:0}))};},
 }});
 assert.equal(result.validationLevel,'dom-only');
 assert.equal(result.totalItems,4);
 assert.deepEqual(result.items.map(x=>x.status),['locator-missing','out-of-scope','needs-review','skipped']);
 assert.deepEqual(called,['#missing']);
 assert.equal(result.items[0]?.missing,1);
 assert.equal(result.items[1]?.checked,0);
 assert.equal(result.items[2]?.needsReview,1);
 assert.equal(identities,4,'validate page at operation boundaries and on both sides of each CDP probe');
});

test('batch isolates a failed script probe but refuses to treat navigation as success',async()=>{
 const cases:any[]=[{path:'a',scriptId:'a',analysis:analysis()},{path:'b',scriptId:'b',analysis:analysis()}];
 let number=0;
 const result=await diagnoseScriptsOnPage({items:cases,target:page,consent:true,deps:{
  confirm:async()=>({targetId:page.id,confirmedUrl:page.url}),
  probe:async()=>{if(number++===0)throw new Error('one script failed');return {targetId:page.id,url:page.url,validationLevel:'dom-only',checks:[{method:'querySelector',expression:'#missing',status:'missing',matchCount:0}]};}
 }});
 assert.deepEqual(result.items.map(x=>x.status),['error','locator-missing']);
 assert.equal(result.items[0]?.reason,'one script failed');
 await assert.rejects(diagnoseScriptsOnPage({items:cases,target:page,consent:true,deps:{
  confirm:async()=>({targetId:page.id,confirmedUrl:'https://other.example'}),
  probe:async()=>{throw new Error('must not call');}
 }}),/identity|navigation|page URL/i);
});

test('strict consent, bounded batch size, bounded selectors and identity reject unsafe evidence',async()=>{
 const deps:any={confirm:async()=>({targetId:'p1',confirmedUrl:page.url}),probe:async()=>({targetId:'wrong-page',url:page.url,checks:[]})};
 await assert.rejects(diagnoseScriptsOnPage({items,target:page,consent:false,deps}),/consent|approval/i);
 await assert.rejects(diagnoseScriptsOnPage({items:Array.from({length:26},()=>items[0]),target:page,consent:true,deps}),/limit/i);
 const tooMany=Array.from({length:51},(_,i)=>({method:'querySelector',expression:'#'+i,runtimeRequired:false,receiver:'document'}));
 const out=await diagnoseScriptsOnPage({items:[{path:'c',scriptId:'c',analysis:analysis(meta(['https://example.org/*']),tooMany)}] as any,target:page,consent:true,deps});
 assert.equal(out.items[0]?.status,'error');
 assert.equal(out.items[0]?.checked,0);
 assert.equal(out.items[0]?.reason,'Selector count exceeds batch safety limit');
 const failed=await diagnoseScriptsOnPage({items:[items[0]],target:page,consent:true,deps});
 assert.equal(failed.items[0]?.status,'error');
 assert.match(failed.items[0]?.reason??'',/identity/i);
});

test('read-only batch never trusts stale page identity even when all scripts are out of scope',async()=>{
 let probed=0;
 await assert.rejects(diagnoseScriptsOnPage({
  items:[items[1]],target:page,consent:true,deps:{
   confirm:async()=>{throw new Error('CDP page navigated before scope evaluation');},
   probe:async()=>{probed++;throw new Error('not called');},
  },
 }),/navigated/);
 assert.equal(probed,0);
});
test('read-only batch performs final identity recheck when all scripts have no static selectors',async()=>{
 let checks=0;
 await assert.rejects(diagnoseScriptsOnPage({
  items:[items[2]],target:page,consent:true,deps:{
   confirm:async()=>{checks++;return {targetId:page.id,confirmedUrl:checks===1?page.url:'https://other.example'};},
   probe:async()=>{throw new Error('no static locators');},
  },
 }),/identity/i);
 assert.equal(checks,2);
});

test('unsupported scope metadata remains needs-review, never falsely out-of-scope',async()=>{
 const cases:any[]=[
  {path:'no-rule.user.js',scriptId:'no-rule',status:'parsed',analysis:analysis(meta([]))},
  {path:'regex-rule.user.js',scriptId:'regex',status:'parsed',analysis:analysis(meta([],))},
  {path:'unknown-exclude.user.js',scriptId:'exclude',status:'parsed',analysis:analysis({
   match:['https://example.org/*'],include:[],raw:{'exclude':['/example\\.org/']},
  })},
 ];
 let probes=0;
 const result=await diagnoseScriptsOnPage({items:cases,target:page,consent:true,deps:{
  confirm:async()=>({targetId:page.id,confirmedUrl:page.url}),
  probe:async()=>{probes++;throw new Error('must not inspect unsupported scopes');},
 }});
 assert.deepEqual(result.items.map(row=>row.status),['needs-review','needs-review','needs-review']);
 assert.ok(result.items.every(row=>row.needsReview>=1));
 assert.equal(probes,0);
});

test('unverified iframe contexts prevent a false missing or out-of-scope verdict for the whole userscript',async()=>{
 const result=await diagnoseScriptsOnPage({items:[items[0],items[1]],target:page,consent:true,deps:{
  confirm:async()=>({targetId:page.id,confirmedUrl:page.url,subframeCount:2}),
  probe:async(_target,locators)=>({targetId:page.id,url:page.url,validationLevel:'dom-only',
   checks:locators.map(x=>({method:x.method,expression:x.expression,status:'missing' as const,matchCount:0}))}),
 }});
 assert.deepEqual(result.items.map(x=>x.status),['needs-review','needs-review']);
 assert.ok(result.items.every(x=>(x.reason??'').includes('iframe')));
 assert.ok(result.items.every(x=>x.needsReview>=1));
 assert.equal(result.items[0]?.missing,0);
});

test('@noframes metadata retains definitive top-document verdict even if the page embeds iframes',async()=>{
 const withNoFrames={match:['https://example.org/*'],include:[],raw:{noframes:['']}};
 const nested=[{path:'top-only.user.js',scriptId:'top-only',status:'parsed',analysis:analysis(withNoFrames)},
  {path:'top-only-other.user.js',scriptId:'other',status:'parsed',analysis:analysis({...withNoFrames,match:['https://other.example/*']})}] as any[];
 const out=await diagnoseScriptsOnPage({items:nested,target:page,consent:true,deps:{
  confirm:async()=>({targetId:page.id,confirmedUrl:page.url,subframeCount:1}),
  probe:async(_target,locators)=>({targetId:page.id,url:page.url,validationLevel:'dom-only',
   checks:locators.map(x=>({method:x.method,expression:x.expression,status:'missing' as const,matchCount:0}))}),
 }});
 assert.deepEqual(out.items.map(x=>x.status),['locator-missing','out-of-scope']);
});
