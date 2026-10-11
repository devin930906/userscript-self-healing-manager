import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diagnoseScriptsOnPage} from '../src/batch-dom.ts';

const target={
 type:'page',id:'fault-tab',url:'https://fixture.example.test/stable',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/fault-tab',
};
const sample=[{
 path:'fixture.user.js',scriptId:'fixture',status:'parsed',
 analysis:{
  metadata:{match:['https://fixture.example.test/*'],include:[],raw:{}},
  selectorRecords:[{method:'querySelector',expression:'#target',receiver:'document',runtimeRequired:false}],
 },
}] as any;
const base=()=>({
 confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'top',loaderId:'stable'}),
 summarize:async()=>({targetId:target.id,url:target.url,authorShadowTreeNodes:0}),
});
const probe=(status:'missing'|'found')=>async(_target:unknown,locators:readonly {method:string;expression:string}[])=>({
 targetId:target.id,url:target.url,validationLevel:'dom-only' as const,
 checks:locators.map(x=>({...x,status,matchCount:status==='found'?1:0})),
});

test('FR-018 confirmed missing DOM is selector-assertion evidence, not webpage or userscript blame',async()=>{
 const result=await diagnoseScriptsOnPage({items:sample,target,consent:true,deps:{...base(),probe:probe('missing')}});
 assert.equal(result.items[0]?.status,'locator-missing');
 assert.deepEqual(result.items[0]?.diagnostic,{
  code:'DOM_SELECTOR_MISSING',origin:'unknown',category:'selector-assertion',
  attribution:'unattributed',functionalVerified:false,
 });
 assert.equal(result.items[0]?.verification?.V3,'not-configured');
});

test('FR-018 arbitrary probe exceptions are not classified from private text',async()=>{
 const secret='https://private.example.test/owner?token=LEAK_ME';
 const result=await diagnoseScriptsOnPage({items:sample,target,consent:true,deps:{
  ...base(),probe:async()=>{throw new Error('Script error or CDP network? '+secret);},
 }});
 assert.equal(result.items[0]?.status,'error');
 assert.deepEqual(result.items[0]?.diagnostic,{
  code:'CDP_PROBE_UNVERIFIED',origin:'unknown',category:'unknown',
  attribution:'unattributed',functionalVerified:false,
 });
 assert.doesNotMatch(JSON.stringify(result),/LEAK_ME|owner\?|private\.example/);
});

test('FR-018 malformed CDP adapter evidence is attributed to protocol boundary only',async()=>{
 const result=await diagnoseScriptsOnPage({items:sample,target,consent:true,deps:{
  ...base(),probe:async()=>({targetId:target.id,url:target.url,validationLevel:'dom-only' as const,checks:[]}),
 }});
 assert.equal(result.items[0]?.status,'error');
 assert.deepEqual(result.items[0]?.diagnostic,{
  code:'CDP_EVIDENCE_REJECTED',origin:'cdp',category:'unknown',
  attribution:'protocol-boundary',functionalVerified:false,
 });
});

test('FR-018 unknown Shadow DOM context and successful DOM queries never invent fault origin',async()=>{
 const uncertain=await diagnoseScriptsOnPage({items:sample,target,consent:true,deps:{
  confirm:base().confirm,probe:probe('missing'),
 }});
 const fine=await diagnoseScriptsOnPage({items:sample,target,consent:true,deps:{
  ...base(),probe:probe('found'),
 }});
 assert.equal(uncertain.items[0]?.status,'needs-review');
 assert.equal(uncertain.items[0]?.diagnostic,undefined);
 assert.equal(fine.items[0]?.status,'dom-present');
 assert.equal(fine.items[0]?.diagnostic,undefined);
});
