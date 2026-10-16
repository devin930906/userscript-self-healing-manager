import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

const frame='fixed-fixture-frame';
const extension='jinjaccalgkegednnccohejagnlnfdag';
const parsed=(url:string,id=frame)=>({
 scriptId:'101',url,executionContextId:9,
 executionContextAuxData:{frameId:id},
});
test('RG-05 official injector scriptParsed only credits two pinned extension assets in the exact fixture main frame',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts').catch(()=>null);
 assert.equal(typeof mod?.createOfficialManagerScriptEvidence,'function','missing bounded official script-parsing probe');
 const e=mod!.createOfficialManagerScriptEvidence(frame,extension);
 const before={injectedWebParsed:false,injectedParsed:false};
 assert.deepEqual(e.snapshot(),before);
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://wrong-extension/injected.js'));
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js','other-frame'));
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js?private=1'));
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js#private'));
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
 assert.deepEqual(e.snapshot(),{injectedWebParsed:false,injectedParsed:true});
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected-web.js'));
 assert.deepEqual(e.snapshot(),{injectedWebParsed:true,injectedParsed:true});
 assert.doesNotMatch(JSON.stringify(e.snapshot()),/chrome-extension|private|frame|101|injected\\.js/);
});
test('RG-05 malformed debugger responses and unpinned frame identities never create false script execution evidence',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts').catch(()=>null);
 assert.equal(typeof mod?.createOfficialManagerScriptEvidence,'function');
 const factory=mod!.createOfficialManagerScriptEvidence;
 for(const frameId of ['', 'x'.repeat(257)])assert.throws(()=>factory(frameId,extension),/frame|identity/i);
 assert.throws(()=>factory(frame,'abcdefghijklmnopabcdefghijklmnop'),/extension|identity|pinned/i);
 const evidence=factory(frame,extension);
 for(const payload of [null,{},[],{scriptId:'',url:'chrome-extension://'+extension+'/injected.js',
  executionContextAuxData:{frameId:frame}},{
  scriptId:'103',url:'chrome-extension://'+extension+'/injected-web.js',
  executionContextAuxData:{frameId:'unexpected'}}, {
  scriptId:'101',url:'chrome-extension://'+extension+'/injected.js',
  executionContextAuxData:{frameId:frame},executionContextId:'9'
 }])evidence.observe('Debugger.scriptParsed',payload);
 evidence.observe('Runtime.executionContextCreated',parsed('chrome-extension://'+extension+'/injected.js'));
 assert.deepEqual(evidence.snapshot(),{injectedWebParsed:false,injectedParsed:false});
});
test('RG-05 debugger script observation is post-receipt only, bounded, and does not weaken cold-start GM gate',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const receipt=source.indexOf('const secondReceipt=assertViolentmonkeyV4FixtureObservation');
 const baseline=source.indexOf('RG-05 official injector parsed scripts control');
 const chromeExit=source.indexOf("browserCdp.send('Browser.close')");
 const missing=source.indexOf('startupInjectionBlocked=true');
 const post=source.indexOf('RG-05 official injector parsed scripts after missing GM receipts');
 const gate=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(receipt>=0&&baseline>receipt&&baseline<chromeExit);
 assert.ok(missing>chromeExit&&post>missing&&gate>post);
 assert.match(source,/await cdp.send\('Debugger.enable'\)/);
 assert.match(source,/await cdp.send\('Debugger.disable'\)/);
 assert.doesNotMatch(source,/Debugger.getScriptSource|Debugger.setScriptSource|Debugger.evaluateOnCallFrame/);
 assert.match(source,/assertOfficialViolentmonkeyReleaseGate\(blocked.status\)/);
});

test('RG-05 attributes live exceptions only to pinned official injector scripts without leaking script IDs',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const factory=(mod as Record<string,unknown>).createPinnedOfficialInjectorExceptionAttribution as
  ((frameId:string,extensionId:string)=>{observe:(method:string,params:unknown)=>void;snapshot:()=>unknown});
 assert.equal(typeof factory,'function','missing official pinned injector exception attribution');
 const evidence=factory(frame,extension);
 evidence.observe('Debugger.scriptParsed',{scriptId:'201',url:'chrome-extension://'+extension+'/injected.js',
  executionContextId:9,executionContextAuxData:{frameId:frame}});
 evidence.observe('Debugger.scriptParsed',{scriptId:'202',url:'chrome-extension://'+extension+'/injected-web.js',
  executionContextId:9,executionContextAuxData:{frameId:frame}});
 evidence.observe('Debugger.scriptParsed',{scriptId:'203',url:'chrome-extension://'+extension+'/injected.js',
  executionContextId:12,executionContextAuxData:{frameId:'other-frame'}});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'201',executionContextId:9,
  text:'PRIVATE_SCRIPT_STACK',exception:{description:'PRIVATE_BROWSER_TOKEN'}}});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'203',executionContextId:12,text:'PRIVATE_OTHER_FRAME'}});
 assert.deepEqual(evidence.snapshot(),{
  injectedWebExceptionObserved:false,injectedExceptionObserved:true,unattributedExceptionObserved:false,
 });
 assert.doesNotMatch(JSON.stringify(evidence.snapshot()),/PRIVATE|201|202|203|chrome-extension|frame/);
});

test('RG-05 runtime exception source attribution is read-only, fail-closed and never used as a GM pass receipt',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const factory=(mod as Record<string,unknown>).createPinnedOfficialInjectorExceptionAttribution as
  ((frameId:string,extensionId:string)=>{observe:(method:string,params:unknown)=>void;snapshot:()=>unknown});
 assert.equal(typeof factory,'function');
 const evidence=factory(frame,extension);
 evidence.observe('Debugger.scriptParsed',{scriptId:'111',url:'chrome-extension://'+extension+'/injected-web.js?token=PRIVATE',
  executionContextId:9,executionContextAuxData:{frameId:frame}});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'111',executionContextId:9,text:'PRIVATE'}});
 assert.deepEqual(evidence.snapshot(),{
  injectedWebExceptionObserved:false,injectedExceptionObserved:false,unattributedExceptionObserved:true,
 });
 const harness=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 assert.match(harness,/createPinnedOfficialInjectorExceptionAttribution/);
 assert.match(harness,/Runtime\.exceptionThrown/);
 assert.match(harness,/Debugger\.scriptParsed/);
 assert.match(harness,/await pageCdp\.send\('Debugger.enable'\)/,
  'subscribe to official scriptParsed before the already-authorized fixture reload');
 const failed=harness.indexOf('startupInjectionBlocked=true');
 const diagnostic=harness.indexOf('RG-05 official injector exception attribution after missing GM receipts');
 const denied=harness.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(failed>=0&&diagnostic>failed&&diagnostic<denied,
  'source classification cannot issue a GM success result or run before two failed receipts');
 assert.doesNotMatch(harness,/Debugger.getScriptSource|Debugger.evaluateOnCallFrame/);
});

test('RG-05 only reports allowlisted exception class for pinned official injected.js without exposing private error strings',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
  ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedExceptionClass:()=>string};
 assert.equal(typeof e.injectedExceptionClass,'function','missing safe injected.js exception class projection');
 assert.equal(e.injectedExceptionClass(),'not-observed');
 e.observe('Runtime.executionContextCreated',{context:{id:9,auxData:{frameId:frame,isDefault:false}}});
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{
  scriptId:'101',executionContextId:9,text:'PRIVATE_ERROR_TEXT',exception:{
   className:'TypeError',description:'PRIVATE_STACK_WITH_SECRET',value:'PRIVATE_GM_VALUE',
  },
 }});
 assert.equal(e.injectedExceptionClass(),'TypeError');
 assert.doesNotMatch(JSON.stringify(e.snapshot())+e.injectedExceptionClass(),/PRIVATE|101|frame|chrome-extension/);
});

test('RG-05 cannot disclose arbitrary exception class names or claim a category on wrong official sources',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const make=()=>{
  const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
   ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedExceptionClass:()=>string};
  e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
  return e;
 };
 for(const [category,expected] of [
  ['ReferenceError','ReferenceError'],['SyntaxError','SyntaxError'],['RangeError','RangeError'],
  ['Error','Error'],['DOMException','unknown'],
  ['PRIVATE_USER_ACCOUNT_TOKEN','unknown'],[null,'unknown'],
 ] as const){
  const e=make();
  e.observe('Runtime.exceptionThrown',{exceptionDetails:{
   executionContextId:9,scriptId:'101',exception:{className:category,description:'PRIVATE_ERROR'},
  }});
  assert.equal(e.injectedExceptionClass(),expected);
  assert.doesNotMatch(e.injectedExceptionClass(),/PRIVATE|TOKEN|URL|frame/);
 }
 const e=make();
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:9,scriptId:'not-official',
  exception:{className:'TypeError'}}});
 assert.equal(e.injectedExceptionClass(),'not-observed');
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:9,scriptId:'101',
  exception:{className:'TypeError'}}});
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:9,scriptId:'101',
  exception:{className:'ReferenceError'}}});
 assert.equal(e.injectedExceptionClass(),'mixed','conflicting official errors cannot yield a single false root cause');
});

test('RG-05 safe exception class is logged only for confirmed failed cold-start receipts',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const control=source.indexOf('RG-05 official injected.js error class control');
 const earlier=source.indexOf('const secondReceipt=assertViolentmonkeyV4FixtureObservation');
 const restart=source.indexOf("browserCdp.send('Browser.close')");
 assert.ok(earlier>=0&&control>earlier&&control<restart);
 const failed=source.indexOf('startupInjectionBlocked=true');
 const actual=source.indexOf('RG-05 official injected.js error class after missing GM receipts');
 const gate=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(failed>=0&&actual>failed&&gate>actual);
 assert.doesNotMatch(source,/Debugger.getScriptSource|Debugger.evaluateOnCallFrame|\.exception\.description/);
});

test('RG-05 recognizes only the official injected.js missing data.info TypeError signature',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
  ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedFailureSignature:()=>string};
 assert.equal(typeof e.injectedFailureSignature,'function','missing pinned injected.js failure signature classifier');
 assert.equal(e.injectedFailureSignature(),'not-observed');
 e.observe('Runtime.executionContextCreated',{context:{id:9,auxData:{frameId:frame,isDefault:false}}});
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{
  scriptId:'101',executionContextId:9,exception:{
   className:'TypeError',
   description:"TypeError: Cannot read properties of undefined (reading 'info')\\n  at init (PRIVATE_ACCOUNT_URL)",
  },
 }});
 assert.equal(e.injectedFailureSignature(),'missing-injection-data-info');
 assert.equal(e.injectedExceptionClass(),'TypeError');
 assert.doesNotMatch(e.injectedFailureSignature()+JSON.stringify(e.snapshot()),/PRIVATE|URL|chrome-extension|101|frame/);
});

test('RG-05 rejects other, malformed and private TypeError descriptions without leaking them',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const factory=()=>{
  const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
   ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedFailureSignature:()=>string};
  e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
  return e;
 };
 for(const [description,expected] of [
  ["TypeError: Cannot read properties of undefined (reading 'password')",'other-type-error'],
  ["TypeError: Cannot read properties of null (reading 'info')",'missing-injection-data-info'],
  ['TypeError: PRIVATE_CUSTOM_MESSAGE','other-type-error'],
  [null,'other-type-error'],
 ] as const){
  const e=factory();
  e.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'101',executionContextId:9,
   exception:{className:'TypeError',description}}});
  assert.equal(e.injectedFailureSignature(),expected);
  assert.doesNotMatch(e.injectedFailureSignature(),/PRIVATE|password|TOKEN|URL/);
 }
 const e=factory();
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'bogus',executionContextId:9,
  exception:{className:'TypeError',description:"TypeError: Cannot read properties of undefined (reading 'info')"}}});
 assert.equal(e.injectedFailureSignature(),'not-observed');
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'101',executionContextId:9,
  exception:{className:'TypeError',description:"TypeError: Cannot read properties of undefined (reading 'info')"}}});
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'101',executionContextId:9,
  exception:{className:'TypeError',description:'TypeError: PRIVATE_OTHER_FAILURE'}}});
 assert.equal(e.injectedFailureSignature(),'mixed');
});

test('RG-05 reports missing-data signature only after two real failed restart documents',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const healthy=source.indexOf('RG-05 official injected.js failure signature control');
 const control=source.indexOf('const secondReceipt=assertViolentmonkeyV4FixtureObservation');
 const stopped=source.indexOf("browserCdp.send('Browser.close')");
 assert.ok(healthy>control&&healthy<stopped);
 const failed=source.indexOf('startupInjectionBlocked=true');
 const diagnostic=source.indexOf('RG-05 official injected.js failure signature after missing GM receipts');
 const strictGate=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(diagnostic>failed&&diagnostic<strictGate,'cannot use a signature as a GM receipt');
 assert.doesNotMatch(source,/Debugger.getScriptSource|Debugger.evaluateOnCallFrame/);
});


test('RG-05 official injector failure site is a bounded public-asset coordinate, never a private CDP payload',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const create=()=>mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension);
 const e=create() as ReturnType<typeof create> & {injectedFailureSite:()=>string};
 assert.equal(typeof e.injectedFailureSite,'function','missing fixed official injected.js fault-site diagnostic');
 assert.equal(e.injectedFailureSite(),'not-observed');
 e.observe('Runtime.executionContextCreated',{context:{id:9,auxData:{frameId:frame,isDefault:false}}});
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{
  scriptId:'101',executionContextId:9,lineNumber:7,columnNumber:12054,
  text:'PRIVATE_OAUTH_QUERY_TOKEN',exception:{className:'TypeError',description:'PRIVATE_ACCOUNT_STACK'},
 }});
 assert.equal(e.injectedFailureSite(),'L7:C12054');
 assert.doesNotMatch(e.injectedFailureSite()+JSON.stringify(e.snapshot()),/PRIVATE|TOKEN|OAuth|101|chrome-extension|frame/);
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{
  scriptId:'101',executionContextId:9,lineNumber:7,columnNumber:12054,
  exception:{className:'TypeError'},
 }});
 assert.equal(e.injectedFailureSite(),'L7:C12054','same location stays stable across repeated official exceptions');
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{
  scriptId:'101',executionContextId:9,lineNumber:7,columnNumber:12055,
  exception:{className:'TypeError'},
 }});
 assert.equal(e.injectedFailureSite(),'multiple','distinct sites cannot be represented as one assumed root');
});

test('RG-05 missing, untrusted or oversized official failure locations must never become source proof',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 for(const position of [
  {lineNumber:-1,columnNumber:2},{lineNumber:1,columnNumber:-1},
  {lineNumber:100001,columnNumber:2},{lineNumber:1,columnNumber:10000001},
  {lineNumber:1.5,columnNumber:4},{lineNumber:'1',columnNumber:4},
  {lineNumber:0,columnNumber:null},{lineNumber:0},
 ]){
  const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
   ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedFailureSite:()=>string};
  e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
  e.observe('Runtime.exceptionThrown',{exceptionDetails:{
   scriptId:'101',executionContextId:9,...position,exception:{className:'TypeError'},
  }});
  assert.equal(e.injectedFailureSite(),'unknown');
 }
 const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
  ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedFailureSite:()=>string};
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{
  scriptId:'forged',executionContextId:9,lineNumber:1,columnNumber:1,
  exception:{className:'TypeError'},
 }});
 assert.equal(e.injectedFailureSite(),'not-observed');
});

test('RG-05 official failure coordinate is reported only after real failed GM cold start, never used to bypass gate',async()=>{
 const script=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const blocked=script.indexOf('startupInjectionBlocked=true');
 const site=script.indexOf('RG-05 official injected.js fault site after missing GM receipts');
 const gate=script.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(blocked>=0&&site>blocked&&gate>site);
 assert.doesNotMatch(script,/Debugger.getScriptSource|Debugger.evaluateOnCallFrame/);
});


test('RG-05 pinned official injected.js AST fingerprint identifies a fixed call without revealing source',async()=>{
 const mod=await import('../../scripts/violentmonkey-public-fault-ast.ts').catch(()=>null);
 assert.equal(typeof mod?.mapPinnedOfficialFaultSite,'function','missing public bundle fault-site AST classification');
 const source="(()=>{const receipt=chrome.runtime.sendMessage({cmd:'GetInjected'});return receipt;})();";
 const spot=source.indexOf('sendMessage')+2;
 const proof=mod!.mapPinnedOfficialFaultSite(source,0,spot);
 assert.deepEqual(Object.keys(proof).sort(),['ancestorKinds','binaryOperandRoles','binaryOperatorKinds','boundMethodKind','callArgumentCount','callArgumentIndex','callArgumentKinds','callKind','calleeBindingKind','calleeBodyBinaryOperatorKinds','calleeBodyKind','calleeFunctionKind','calleeParameterCount','calleeStatementCount','elementBaseBindingKind','elementBaseInitializerKind','elementBaseKind','elementIndexKind','expressionRole','fingerprintSha256','firstArgumentLiteralKind','fixedUpstreamShape','locationVerified','propertyKind','syntaxKind'].sort());
 assert.equal(proof.locationVerified,true);
 assert.equal(proof.callKind,'member-call');
 assert.equal(proof.propertyKind,'sendMessage');
 assert.equal(typeof proof.syntaxKind,'string');
 assert.match(proof.fingerprintSha256,/^[0-9a-f]{64}$/);
 assert.doesNotMatch(JSON.stringify(proof),/GetInjected|chrome|receipt|runtime|function|PRIVATE_TOKEN/);
});

test('RG-05 AST fault-site mapping never leaks arbitrary identifiers, asset text, or bad coordinates',async()=>{
 const mod=await import('../../scripts/violentmonkey-public-fault-ast.ts').catch(()=>null);
 assert.equal(typeof mod?.mapPinnedOfficialFaultSite,'function');
 const secret="function PRIV_OAUTH_SECRET(){return accountPrivateProperty()}";
 for(const [row,col] of [[-1,1],[0,-1],[0,9999],[5,2],[0,NaN],[0,1.5],[100001,0],[0,10000001]]){
  assert.deepEqual(mod!.mapPinnedOfficialFaultSite(secret,row,col).locationVerified,false);
 }
 const proof=mod!.mapPinnedOfficialFaultSite(secret,0,20);
 assert.equal(proof.propertyKind,'other');
 assert.doesNotMatch(JSON.stringify(proof),/PRIV|OAUTH|account|PrivateProperty|SECRET|function/);
 assert.deepEqual(mod!.mapPinnedOfficialFaultSite('',0,0).locationVerified,false);
});

test('RG-05 production CFT diagnostic reads only the pinned public asset after two absent GM receipts',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const failed=source.indexOf('startupInjectionBlocked=true');
 const proof=source.indexOf('RG-05 public official injected.js AST site after missing GM receipts');
 const gate=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(failed>=0&&proof>failed&&gate>proof);
 assert.match(source,/mapPinnedOfficialFaultSite/);
 assert.match(source,/readPinnedRegularFile/);
 assert.doesNotMatch(source,/Debugger.getScriptSource|Debugger.evaluateOnCallFrame|\\.exception\\.description/);
});


test('RG-05 pinned official fault mapping exposes only bounded syntax ancestry and expression role, never source identifiers',async()=>{
 const mod=await import('../../scripts/violentmonkey-public-fault-ast.ts');
 const source="(()=>{const result=forward(payload[secretIndex]);return result;})();";
 const spot=source.indexOf('payload[')+2;
 const proof=mod.mapPinnedOfficialFaultSite(source,0,spot) as typeof mod extends never ? never : any;
 assert.equal(proof.locationVerified,true);
 assert.equal(proof.expressionRole,'call-argument');
 assert.equal(proof.callArgumentIndex,0);
 assert.ok(Array.isArray(proof.ancestorKinds));
 assert.ok(proof.ancestorKinds.length>=2&&proof.ancestorKinds.length<=6);
 assert.ok(proof.ancestorKinds.every((kind:unknown)=>typeof kind==='string'&&kind.length>0&&kind.length<64));
 assert.doesNotMatch(JSON.stringify(proof),/payload|secretIndex|forward|result|PRIVATE|source/i);
});


test('RG-05 public AST mapper resolves safe-bind helper shape and only allowlisted bound method semantics',async()=>{
 const mod=await import('../../scripts/violentmonkey-public-fault-ast.ts');
 const source=[
  "const apply={call:{bind(){}}};",
  "const safeCall=apply.call.bind(apply.call);",
  "const {forEach:each}=[];",
  "const args=[];",
  "args[0]&&safeCall(each,args[0],()=>{});",
 ].join('');
 const spot=source.lastIndexOf('args[0]')+2;
 const proof=mod.mapPinnedOfficialFaultSite(source,0,spot) as any;
 assert.equal(proof.locationVerified,true);
 assert.equal(proof.callKind,'direct-call');
 assert.equal(proof.expressionRole,'call-argument');
 assert.equal(proof.callArgumentIndex,1);
 assert.equal(proof.calleeBindingKind,'safe-call-shape');
 assert.equal(proof.boundMethodKind,'forEach');
 assert.doesNotMatch(JSON.stringify(proof),/safeCall|\beach\b|\bargs\b|PRIVATE|identifierText/i);
});


test('RG-05 public fault mapper exposes bounded call, element and binary structure for source-semantic matching',async()=>{
 const mod=await import('../../scripts/violentmonkey-public-fault-ast.ts');
 const source=[
  "const helper=(left,right)=>right;",
  "const list=[];",
  "let gate=true,other=false,out=false;",
  "{gate&&(out=other||helper('x',list[1]));}",
 ].join('');
 const spot=source.lastIndexOf('list[1]')+2;
 const proof=mod.mapPinnedOfficialFaultSite(source,0,spot) as any;
 assert.equal(proof.locationVerified,true);
 assert.equal(proof.callArgumentCount,2);
 assert.equal(proof.callArgumentIndex,1);
 assert.equal(proof.elementBaseKind,'Identifier');
 assert.equal(proof.elementBaseBindingKind,'variable');
 assert.equal(proof.elementIndexKind,'number-1');
 assert.equal(proof.calleeFunctionKind,'arrow-expression');
 assert.equal(proof.calleeParameterCount,2);
 assert.equal(proof.calleeStatementCount,0);
 assert.deepEqual(proof.binaryOperatorKinds.slice(0,2),['BarBarToken','EqualsToken']);
 assert.deepEqual(proof.binaryOperandRoles.slice(0,2),['right','right']);
 for(const key of ['binaryOperatorKinds','binaryOperandRoles']){
  assert.ok(Array.isArray(proof[key])&&proof[key].length<=4);
 }
 assert.doesNotMatch(JSON.stringify(proof),/helper|\blist\b|\bgate\b|\bout\b|PRIVATE|identifierText/i);
});


test('RG-05 public fault mapper can prove or falsify the fixed notification relay source shape without raw names',async()=>{
 const mod=await import('../../scripts/violentmonkey-public-fault-ast.ts');
 const source=[
  "const sink=(a,b,c)=>b;",
  "const relay=(msg,n)=>n&&sink(msg,n.id,n.realm)&&n;",
  "const notifications=Object.create(null);",
  "const nid='fixed';",
  "relay('NotificationClicked',notifications[nid]);",
 ].join('');
 const spot=source.lastIndexOf('notifications[nid]')+4;
 const proof=mod.mapPinnedOfficialFaultSite(source,0,spot) as any;
 assert.deepEqual(proof.callArgumentKinds,['StringLiteral','ElementAccessExpression']);
 assert.equal(proof.firstArgumentLiteralKind,'NotificationClicked');
 assert.equal(proof.calleeBodyKind,'BinaryExpression');
 assert.deepEqual(proof.calleeBodyBinaryOperatorKinds.slice(0,2),['AmpersandAmpersandToken','AmpersandAmpersandToken']);
 assert.equal(proof.elementBaseInitializerKind,'CallExpression');
 assert.doesNotMatch(JSON.stringify(proof),/\brelay\b|notifications|\bnid\b|\bsink\b|PRIVATE|identifierText/i);
});


test('RG-05 static mapper recognizes only the fixed MV3 runtime.onMessage listener-wrapper source shape',async()=>{
 const mod=await import('../../scripts/violentmonkey-public-fault-ast.ts');
 const positive=[
  "const wrap=(onMessage,addListener)=>(listener=>onMessage[addListener](listener));",
  "const runtime={onMessage:{}};",
  "let obj;",
  "const key='addListener';",
  "obj=runtime.onMessage;",
  "obj[key]=wrap(obj,obj[key]);",
 ].join('');
 const spot=positive.lastIndexOf('obj[key]')+2;
 const proof=mod.mapPinnedOfficialFaultSite(positive,0,spot) as any;
 assert.equal(proof.locationVerified,true);
 assert.equal(proof.fixedUpstreamShape,'mv3-runtime-onmessage-listener-wrapper');
 assert.doesNotMatch(JSON.stringify(proof),/\bwrap\b|\bobj\b|\bkey\b|PRIVATE|identifierText/i);
 for(const source of [
  positive.replace('runtime.onMessage','runtime.onConnect'),
  positive.replace('wrap(obj,obj[key])','wrap(obj,other[key])'),
  positive.replace('obj[key]=wrap(obj,obj[key])','obj.other=wrap(obj,obj[key])'),
 ]){
  const at=source.lastIndexOf('obj[key]')+2;
  const result=mod.mapPinnedOfficialFaultSite(source,0,at) as any;
  assert.notEqual(result.fixedUpstreamShape,'mv3-runtime-onmessage-listener-wrapper');
 }
});


test('RG-05 recognizes only the fixed runtime.onMessage addListener nullish TypeError signature',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const make=()=>{
  const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
   ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedFailureSignature:()=>string};
  e.observe('Runtime.executionContextCreated',{context:{id:9,auxData:{frameId:frame,isDefault:false}}});
  e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
  return e;
 };
 for(const description of [
  "TypeError: Cannot read properties of undefined (reading 'addListener')",
  "TypeError: Cannot read properties of null (reading 'addListener')\n  at PUBLIC_FIXED_BUNDLE",
 ]){
  const e=make();
  e.observe('Runtime.exceptionThrown',{exceptionDetails:{
   scriptId:'101',executionContextId:9,exception:{className:'TypeError',description},
  }});
  assert.equal(e.injectedFailureSignature(),'missing-runtime-onmessage-addlistener');
  assert.doesNotMatch(e.injectedFailureSignature()+JSON.stringify(e.snapshot()),/PUBLIC_FIXED_BUNDLE|chrome-extension|101|frame/);
 }
 const other=make();
 other.observe('Runtime.exceptionThrown',{exceptionDetails:{
  scriptId:'101',executionContextId:9,exception:{
   className:'TypeError',
   description:"TypeError: Cannot read properties of undefined (reading 'removeListener')",
  },
 }});
 assert.equal(other.injectedFailureSignature(),'other-type-error');
});


test('RG-05 rejects inherited and accessor-backed debugger scriptParsed metadata before attributing official injector parses',async()=>{
 const {createOfficialManagerScriptEvidence}=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const trusted=parsed('chrome-extension://'+extension+'/injected.js');
 let gettersCalled=0;
 const nestedAccessor={};
 Object.defineProperty(nestedAccessor,'frameId',{
  get(){gettersCalled++;throw new Error('PRIVATE_FRAME_ID');},
 });
 const eventAccessor={};
 Object.defineProperty(eventAccessor,'scriptId',{
  get(){gettersCalled++;throw new Error('PRIVATE_SCRIPT_ID');},
 });
 Object.assign(eventAccessor,{
  url:trusted.url,executionContextId:9,executionContextAuxData:{frameId:frame},
 });
 const inheritedEvent=Object.create(trusted);
 const inheritedAux=Object.create({frameId:frame});
 const nestedInherited={...trusted,executionContextAuxData:inheritedAux};
 const events=[inheritedEvent,eventAccessor,
  {...trusted,executionContextAuxData:nestedAccessor},
  nestedInherited];
 for(const event of events){
  const observer=createOfficialManagerScriptEvidence(frame,extension);
  assert.doesNotThrow(()=>observer.observe('Debugger.scriptParsed',event),
   'malformed CDP event must not run an accessor or crash observation');
  assert.deepEqual(observer.snapshot(),{injectedWebParsed:false,injectedParsed:false},
   'inherited or accessor-backed metadata cannot prove an official injector parsed');
 }
 assert.equal(gettersCalled,0,'event observation must not invoke private getters');
 const valid=createOfficialManagerScriptEvidence(frame,extension);
 valid.observe('Debugger.scriptParsed',trusted);
 assert.deepEqual(valid.snapshot(),{injectedWebParsed:false,injectedParsed:true},
  'a legitimate decoded own-data CDP event remains accepted');
});
