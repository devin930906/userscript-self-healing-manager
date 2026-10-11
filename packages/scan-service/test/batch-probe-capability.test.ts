import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diagnoseScriptsOnPage} from '../src/batch-dom.ts';

const page={
 type:'page',id:'capability-tab',url:'https://example.org/app',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/capability-tab',
};
const confirmed=()=>({targetId:page.id,confirmedUrl:page.url,frameId:'root',loaderId:'stable'});
const script=(records:readonly {method:string;expression:string;receiver:string;runtimeRequired:boolean}[])=>({
 path:'fixture.user.js',scriptId:'fixture',status:'parsed',
 analysis:{metadata:{match:['https://example.org/*'],include:[],raw:{}},selectorRecords:records},
});
const staticLocator={method:'querySelector',expression:'#static',receiver:'document',runtimeRequired:false};
const dynamicLocator={method:'querySelector',expression:'dynamicId',receiver:'document',runtimeRequired:true};
const nestedLocator={method:'querySelector',expression:'#inside',receiver:'panel',runtimeRequired:false};
const unsupportedLocator={method:'closest',expression:'.card',receiver:'document',runtimeRequired:false};
async function run(records:readonly typeof staticLocator[],responses:readonly {
 status:'found'|'missing'|'ambiguous'|'blocked'|'unverified';matchCount:number|null
}[],includeRecheck=false){
 let probes=0;
 return diagnoseScriptsOnPage({items:[script(records)] as any,target:page,consent:true,deps:{
  confirm:async()=>confirmed(),
  summarize:async()=>({targetId:page.id,url:page.url,authorShadowTreeNodes:0}),
  ...(includeRecheck?{waitBeforeMissingRecheck:async()=>{}}:{}),
  probe:async(_target,locators)=>({targetId:page.id,url:page.url,validationLevel:'dom-only' as const,
   checks:locators.map((locator,i)=>({
    method:locator.method,expression:locator.expression,
    ...(includeRecheck&&++probes===1?{status:'missing' as const,matchCount:0}:responses[i]!),
   })),
  }),
 }});
}
test('FR-024 forged found on runtime-required selector cannot make whole batch V1 pass',async()=>{
 const result=await run([staticLocator,dynamicLocator],
  [{status:'found',matchCount:1},{status:'found',matchCount:1}]);
 assert.equal(result.items[0]?.status,'error');
 assert.equal(result.items[0]?.verification?.V1,'blocked');
 assert.equal(result.items[0]?.reason,'CDP evidence identity or shape mismatch');
});
test('FR-024 read-only batch denies forged positive on nested receivers and unsupported methods',async()=>{
 for(const locator of [nestedLocator,unsupportedLocator]){
  const result=await run([staticLocator,locator],
   [{status:'found',matchCount:1},{status:'found',matchCount:1}]);
  assert.equal(result.items[0]?.status,'error',locator.method);
  assert.equal(result.items[0]?.verification?.V1,'blocked',locator.method);
 }
});
test('FR-024 legitimate unavailable CDP capability stays inconclusive, not an error or a V1 pass',async()=>{
 for(const locator of [dynamicLocator,nestedLocator,unsupportedLocator]){
  const result=await run([staticLocator,locator],
   [{status:'found',matchCount:1},{status:'unverified',matchCount:null}]);
  assert.equal(result.items[0]?.status,'needs-review',locator.method);
  assert.equal(result.items[0]?.verification?.V1,'blocked',locator.method);
  assert.equal(result.items[0]?.found,1);
  assert.equal(result.items[0]?.needsReview,1);
 }
});
test('FR-024 malformed result for one script does not block an independent safe script',async()=>{
 let call=0;
 const scripts=[script([staticLocator,dynamicLocator]),script([staticLocator])] as any[];
 const out=await diagnoseScriptsOnPage({items:scripts,target:page,consent:true,deps:{
  confirm:async()=>confirmed(),
  probe:async(_target,locators)=>{
   call++;
   return {targetId:page.id,url:page.url,validationLevel:'dom-only' as const,
    checks:locators.map(locator=>({method:locator.method,expression:locator.expression,status:'found' as const,matchCount:1}))};
  },
 }});
 assert.equal(call,2);
 assert.deepEqual(out.items.map(x=>x.status),['error','dom-present']);
 assert.deepEqual(out.items.map(x=>x.verification?.V1),['blocked','passed']);
});
