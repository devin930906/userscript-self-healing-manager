import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runSiteAdapterRoleDomCheck} from '../src/site-adapter-role.ts';
import {parseSiteAdapter} from '../../candidate-engine/src/site-adapter.ts';
import type {LocatorProbeResult,LiteralLocator} from '../../cdp-client/src/locator-probe.ts';
import type {ChromeTarget} from '../../cdp-client/src/index.ts';

const target={id:'tab-01',url:'https://example.org/app/inbox',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/tab-01'} as ChromeTarget;
const adapter=parseSiteAdapter({
 schemaVersion:1,siteId:'example-app',version:'1.0.0',
 urlPatterns:['https://example.org/app/*'],
 states:{ready:{description:'User-declared ready state'},loading:{description:'Loading'}},
 roles:{
  'chat.sendButton':{contexts:[{stateId:'ready',frame:'top',shadow:'none'}],
   strategies:[{kind:'css',selector:'[data-testid="send-button"]',weight:100},{kind:'css',selector:'#send-backup',weight:50}],
   cardinality:{min:1,max:1},assertions:['unique']},
  'chat.frameButton':{contexts:[{stateId:'ready',frame:'iframe',shadow:'none'}],
   strategies:[{kind:'css',selector:'#frame-send',weight:70}],cardinality:{min:1,max:1},assertions:['unique']},
 },
 validationCases:['SEND_EXISTS'],
});
const identity={targetId:target.id,confirmedUrl:target.url,frameId:'main',loaderId:'load-1',subframeCount:0};
const status=(entries:Record<string,number>)=>({
 targetId:target.id,url:target.url,validationLevel:'dom-only' as const,
 checks:Object.entries(entries).map(([expression,matchCount])=>({method:'querySelectorAll',expression,matchCount,status:matchCount===0?'missing':'found',...(matchCount===1?{nodeFingerprint:'a'.repeat(64)}:{})})),
});
const makeDeps=(first:number[],second=first)=>({
 confirm:async()=>identity,
 probe:async(_t:ChromeTarget,locators:readonly LiteralLocator[]):Promise<LocatorProbeResult>=>status(Object.fromEntries(locators.map((x,i)=>[x.expression,first[i]??0]))) as LocatorProbeResult,
 summarize:async()=>({targetId:target.id,url:target.url,authorShadowTreeNodes:0}),
 wait:async()=>{},
});
test('role checks require explicit approval and never run CDP for unapproved or wrong-scope targets',async()=>{
 let calls=0;
 const deps={...makeDeps([1,0]),confirm:async()=>{calls++;return identity;},probe:async()=>{calls++;throw Error('should not connect');}};
 await assert.rejects(runSiteAdapterRoleDomCheck({approved:false,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps}),/approval|consent/i);
 const wrong={...target,url:'https://evil.org/app/inbox'};
 const outside=await runSiteAdapterRoleDomCheck({approved:true,target:wrong,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps});
 assert.equal(outside.status,'out-of-scope');
 const nested=await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.frameButton',declaredStateId:'ready',deps});
 assert.equal(nested.status,'blocked-context');
 const loading=await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'loading',deps});
 assert.equal(loading.status,'blocked-context');
 assert.equal(calls,0);
});
test('two consistent DOM samples report only V1, not manager/functional verification',async()=>{
 let probes=0;
 const deps={...makeDeps([1,0]),probe:async(_t:ChromeTarget,locators:readonly LiteralLocator[]):Promise<LocatorProbeResult>=>{
  probes++;return status(Object.fromEntries(locators.map((x,i)=>[x.expression,i===0?1:0]))) as LocatorProbeResult;
 }};
 const r=await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps});
 assert.equal(r.status,'matched-v1');
 assert.equal(r.matchedSelector,'[data-testid="send-button"]');
 assert.equal(r.evidenceLevel,'V1');assert.equal(r.V2,'blocked');assert.equal(r.V3,'not-configured');
 assert.equal(r.V4,'not-configured');assert.equal(r.functionalVerified,false);assert.equal(r.managerVerified,false);
 assert.equal(r.declaredStateVerified,false);
 assert.equal(probes,2);
});
test('two fallback selectors with matches are ambiguous even if each matches one DOM node',async()=>{
 const r=await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps:makeDeps([1,1])});
 assert.equal(r.status,'needs-review');assert.equal(r.matchedSelector,null);
});
test('unstable node counts, invalid CDP observations and same-URL reload cannot be promoted to V1 pass',async()=>{
 let calls=0;
 const changing={...makeDeps([1,0]),probe:async(_t:ChromeTarget,locators:readonly LiteralLocator[]):Promise<LocatorProbeResult>=>{
  calls++;return status(Object.fromEntries(locators.map((x,i)=>[x.expression,calls===1&&i===0?1:0]))) as LocatorProbeResult;
 }};
 const unstable=await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps:changing});
 assert.equal(unstable.status,'needs-review');
 const invalid={...makeDeps([1,0]),probe:async()=>({
  ...status({'[data-testid="send-button"]':1,'#send-backup':0}),
  checks:[{method:'querySelectorAll',expression:'some-other-selector',matchCount:1,status:'found'}],
 }) as LocatorProbeResult};
 const weird=await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps:invalid});
 assert.equal(weird.status,'needs-review');
 let identityCalls=0;
 const navigated={...makeDeps([1,0]),confirm:async()=>({...identity,loaderId:++identityCalls>=3?'load-2':'load-1'})};
 await assert.rejects(runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps:navigated}),/identity|document|reload/i);
});
test('top-document zero matches cannot claim failure if iframe or ShadowRoot exists or snapshot fails',async()=>{
 const blockedFrames={...makeDeps([0,0]),confirm:async()=>({...identity,subframeCount:1})};
 const nested=await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps:blockedFrames});
 assert.equal(nested.status,'needs-review');
 const shadows={...makeDeps([0,0]),summarize:async()=>({targetId:target.id,url:target.url,authorShadowTreeNodes:8})};
 assert.equal((await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps:shadows})).status,'needs-review');
 const missingContext={...makeDeps([0,0]),summarize:async()=>{throw Error('snapshot failed');}};
 assert.equal((await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps:missingContext})).status,'needs-review');
 const plain=await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps:makeDeps([0,0])});
 assert.equal(plain.status,'absent-v1');assert.equal(plain.functionalVerified,false);
});

test('stable match count with replaced backend node identity must not certify SiteAdapter V1',async()=>{
 let probeCount=0;
 const deps={...makeDeps([1,0]),probe:async(_t:ChromeTarget,locators:readonly LiteralLocator[]):Promise<LocatorProbeResult>=>{
  probeCount++;
  const reply=status(Object.fromEntries(locators.map((x,i)=>[x.expression,i===0?1:0])));
  return {...reply,checks:reply.checks.map((item,i)=>i===0?{...item,nodeFingerprint:(probeCount===1?'a':'b').repeat(64)}:item)} as LocatorProbeResult;
 }};
 const result=await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps});
 assert.equal(result.status,'needs-review');
 assert.equal(result.evidenceLevel,'none');
 assert.equal(result.matchedSelector,null);
 assert.equal(result.functionalVerified,false);
 assert.equal(probeCount,2);
});
test('missing, malformed and unverified backend identity never certify matched V1',async()=>{
 for(const nodeFingerprint of [undefined,'short','0'.repeat(64).toUpperCase()]){
  const deps={...makeDeps([1,0]),probe:async(_t:ChromeTarget,locators:readonly LiteralLocator[]):Promise<LocatorProbeResult>=>{
   const reply=status(Object.fromEntries(locators.map((x,i)=>[x.expression,i===0?1:0])));
   return {...reply,checks:reply.checks.map((item,i)=>i===0?{...item,nodeFingerprint}:item)} as LocatorProbeResult;
  }};
  const result=await runSiteAdapterRoleDomCheck({approved:true,target,adapter,roleId:'chat.sendButton',declaredStateId:'ready',deps});
  assert.equal(result.status,'needs-review');
 }
});
