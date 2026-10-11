import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
 parseSiteAdapter,resolveSiteAdapterRole,assessSiteAdapterUpgrade,
} from '../src/site-adapter.ts';

const valid=()=>({
 schemaVersion:1,siteId:'example-app',version:'1.0.0',
 urlPatterns:['https://example.org/app/*'],
 states:{ready:{description:'Authenticated app view'},loading:{description:'Loading shell'}},
 roles:{
  'chat.sendButton':{
   contexts:[{stateId:'ready',frame:'top',shadow:'none'}],
   strategies:[{kind:'css',selector:'[data-testid="send-button"]',weight:100},{kind:'css',selector:'#send-control',weight:60}],
   cardinality:{min:1,max:1},assertions:['exists','unique'],
  },
  'chat.frameButton':{
   contexts:[{stateId:'ready',frame:'iframe',shadow:'none'}],
   strategies:[{kind:'css',selector:'#send-inside-frame',weight:80}],
   cardinality:{min:1,max:1},assertions:['unique'],
  },
 },
 validationCases:['APP_READY','SEND_EXISTS'],
});
test('valid versioned adapter is normalized as a local definition, never a runtime functional pass',()=>{
 const adapter=parseSiteAdapter(valid());
 assert.equal(adapter.siteId,'example-app');
 assert.equal(adapter.version,'1.0.0');
 assert.deepEqual(adapter.roles['chat.sendButton']?.strategies.map(x=>x.weight),[100,60]);
 const role=resolveSiteAdapterRole({adapter,pageUrl:'https://example.org/app/inbox',roleId:'chat.sendButton',observedStateId:'ready'});
 assert.equal(role.status,'candidate-only');
 assert.deepEqual(role.selectors,['[data-testid="send-button"]','#send-control']);
 assert.equal(role.functionalVerified,false);
 assert.equal(role.managerVerified,false);
 assert.equal(role.validationLevel,'definition-only');
});
test('unsupported nested context and unknown state are never guessed into top-document selector evidence',()=>{
 const adapter=parseSiteAdapter(valid());
 for(const observedStateId of [null,'loading','missing']){
  const outcome=resolveSiteAdapterRole({adapter,pageUrl:'https://example.org/app/inbox',roleId:'chat.sendButton',observedStateId});
  assert.equal(outcome.status,'blocked-context');
  assert.deepEqual(outcome.selectors,[]);
 }
 const nested=resolveSiteAdapterRole({adapter,pageUrl:'https://example.org/app/inbox',roleId:'chat.frameButton',observedStateId:'ready'});
 assert.equal(nested.status,'candidate-only');
 assert.equal(nested.rootScope,'iframe-document');
 assert.deepEqual(nested.selectors,['#send-inside-frame']);
});
test('site adapter scope never leaks across domains, excluded paths, or unsupported URL schemes',()=>{
 const adapter=parseSiteAdapter(valid());
 for(const url of ['https://evil.org/app/inbox','https://example.org/other','file:///app/inbox','https://example.org.evil.net/app/inbox']){
  const got=resolveSiteAdapterRole({adapter,pageUrl:url,roleId:'chat.sendButton',observedStateId:'ready'});
  assert.equal(got.status,'out-of-scope');
  assert.deepEqual(got.selectors,[]);
 }
});
test('invalid schema and unsafe role definitions fail closed',()=>{
 const cases=[
  {...valid(),schemaVersion:2},
  {...valid(),version:'latest'},
  {...valid(),urlPatterns:['<all_urls>']},
  {...valid(),urlPatterns:['https://*/*']},
  {...valid(),urlPatterns:['https://example.org:443/*']},
  {...valid(),roles:{'chat.sendButton':{...valid().roles['chat.sendButton'],strategies:[{kind:'javascript',selector:'alert(1)',weight:100}]}}},
  {...valid(),roles:{'chat.sendButton':{...valid().roles['chat.sendButton'],strategies:[{kind:'css',selector:'[data-testid="foo"]',weight:100},{kind:'css',selector:'[data-testid="foo"]',weight:80}]}}},
  {...valid(),roles:{'chat.sendButton':{...valid().roles['chat.sendButton'],contexts:[{stateId:'missing',frame:'top',shadow:'none'}]}}},
  {...valid(),roles:{'chat.sendButton':{...valid().roles['chat.sendButton'],cardinality:{min:2,max:1}}}},
  {...valid(),unexpected:'injected'},
 ];
 for(const obj of cases)assert.throws(()=>parseSiteAdapter(obj),/adapter|schema|version|scope|pattern|role|strategy|context|cardinality|field|unsupported|duplicate/i);
 assert.throws(()=>parseSiteAdapter(JSON.parse('{"schemaVersion":1,"siteId":"x","version":"1.0.0","urlPatterns":["https://example.org/*"],"states":{"__proto__":{}},"roles":{},"validationCases":[]}')),/unsafe|key|prototype|state/i);
});
test('adapter upgrade impact enumerates pinned dependent scripts and required regressions',()=>{
 const previous=parseSiteAdapter(valid());
 const nextRaw=valid();nextRaw.version='1.1.0';
 nextRaw.roles['chat.sendButton']!.strategies=[{kind:'css',selector:'[data-testid="new-send-button"]',weight:100}];
 const next=parseSiteAdapter(nextRaw);
 const report=assessSiteAdapterUpgrade({previous,next,dependencies:[
  {scriptId:'script-one',siteId:'example-app',pinnedVersion:'1.0.0',roles:['chat.sendButton'],regressionCases:['CUSTOM_SEND']},
  {scriptId:'script-two',siteId:'example-app',pinnedVersion:'1.0.0',roles:['chat.frameButton'],regressionCases:['CUSTOM_FRAME']},
  {scriptId:'unrelated',siteId:'other-app',pinnedVersion:'1.0.0',roles:['chat.sendButton'],regressionCases:['OTHER']},
 ]});
 assert.equal(report.status,'review-required');
 assert.deepEqual(report.changedRoles,['chat.sendButton']);
 assert.deepEqual(report.affectedScriptIds,['script-one']);
 assert.deepEqual(report.requiredRegressionCases,['APP_READY','CUSTOM_SEND','SEND_EXISTS']);
 assert.equal(report.autoActivateAllowed,false);
});
test('upgrades refuse version reuse, downgrade and missing dependent role even with valid definitions',()=>{
 const previous=parseSiteAdapter(valid());
 const changed=valid();changed.roles['chat.sendButton']!.strategies=[{kind:'css',selector:'#different',weight:100}];
 const noVersion=parseSiteAdapter(changed);
 assert.throws(()=>assessSiteAdapterUpgrade({previous,next:noVersion,dependencies:[]}),/version|increment|newer/i);
 changed.version='0.9.0';
 assert.throws(()=>assessSiteAdapterUpgrade({previous,next:parseSiteAdapter(changed),dependencies:[]}),/version|newer|downgrade/i);
 const removed=valid();removed.version='2.0.0';delete (removed.roles as Record<string,unknown>)['chat.sendButton'];
 const impact=assessSiteAdapterUpgrade({previous,next:parseSiteAdapter(removed),dependencies:[
  {scriptId:'script-one',siteId:'example-app',pinnedVersion:'1.0.0',roles:['chat.sendButton'],regressionCases:[]},
 ]});
 assert.deepEqual(impact.removedRoles,['chat.sendButton']);
 assert.equal(impact.status,'blocked-removal');
 assert.deepEqual(impact.affectedScriptIds,['script-one']);
});

test('scope-only SiteAdapter upgrades flag all pinned dependencies even with unchanged selectors',()=>{
 const previous=parseSiteAdapter(valid());
 const nextRaw=valid();
 nextRaw.version='1.1.0';
 nextRaw.urlPatterns=['https://example.org/app/*','https://example.org/dashboard/*'];
 const report=assessSiteAdapterUpgrade({previous,next:parseSiteAdapter(nextRaw),dependencies:[
  {scriptId:'script-one',siteId:'example-app',pinnedVersion:'1.0.0',roles:['chat.sendButton'],regressionCases:['SEND_FLOW']},
  {scriptId:'script-two',siteId:'example-app',pinnedVersion:'1.0.0',roles:['chat.frameButton'],regressionCases:['FRAME_FLOW']},
  {scriptId:'future-version',siteId:'example-app',pinnedVersion:'2.0.0',roles:['chat.sendButton'],regressionCases:['OTHER_VERSION']},
  {scriptId:'other-site',siteId:'other-site',pinnedVersion:'1.0.0',roles:['chat.sendButton'],regressionCases:['OTHER_SITE']},
 ]});
 assert.deepEqual(report.changedRoles,[]);
 assert.equal(report.changedScope,true);
 assert.deepEqual(report.addedScopePatterns,['https://example.org/dashboard/*']);
 assert.deepEqual(report.removedScopePatterns,[]);
 assert.equal(report.changedValidationCases,false);
 assert.equal(report.status,'review-required');
 assert.deepEqual(report.affectedScriptIds,['script-one','script-two']);
 assert.deepEqual(report.requiredRegressionCases,['APP_READY','FRAME_FLOW','SEND_EXISTS','SEND_FLOW']);
 assert.equal(report.autoActivateAllowed,false);
});
test('removing a scope pattern with active pinned scripts is blocked even if roles do not change',()=>{
 const oldRaw=valid();
 oldRaw.urlPatterns=['https://example.org/app/*','https://example.org/legacy/*'];
 const previous=parseSiteAdapter(oldRaw);
 const nextRaw=valid();nextRaw.version='2.0.0';
 const report=assessSiteAdapterUpgrade({previous,next:parseSiteAdapter(nextRaw),dependencies:[
  {scriptId:'old-usage',siteId:'example-app',pinnedVersion:'1.0.0',roles:['chat.sendButton'],regressionCases:['LEGACY_ROUTE']},
 ]});
 assert.equal(report.changedScope,true);
 assert.deepEqual(report.removedScopePatterns,['https://example.org/legacy/*']);
 assert.equal(report.status,'blocked-scope');
 assert.deepEqual(report.affectedScriptIds,['old-usage']);
 assert.ok(report.requiredRegressionCases.includes('LEGACY_ROUTE'));
 assert.equal(report.autoActivateAllowed,false);
});
test('validation-only changes affect pinned scripts and removals block loss of coverage',()=>{
 const previous=parseSiteAdapter(valid());
 const expanded=valid();expanded.version='1.0.1';
 expanded.validationCases=['APP_READY','SEND_EXISTS','SEND_RETRY'];
 const deps=[{scriptId:'integration',siteId:'example-app',pinnedVersion:'1.0.0',roles:['chat.frameButton'],regressionCases:['CUSTOM_CHECK']}];
 const report=assessSiteAdapterUpgrade({previous,next:parseSiteAdapter(expanded),dependencies:deps});
 assert.deepEqual(report.changedRoles,[]);
 assert.equal(report.changedScope,false);
 assert.equal(report.changedValidationCases,true);
 assert.equal(report.status,'review-required');
 assert.deepEqual(report.affectedScriptIds,['integration']);
 assert.deepEqual(report.requiredRegressionCases,['APP_READY','CUSTOM_CHECK','SEND_EXISTS','SEND_RETRY']);
 const removed=valid();removed.version='1.0.2';removed.validationCases=['APP_READY'];
 const blocked=assessSiteAdapterUpgrade({previous,next:parseSiteAdapter(removed),dependencies:deps});
 assert.equal(blocked.status,'blocked-validation');
 assert.deepEqual(blocked.removedValidationCases,['SEND_EXISTS']);
 assert.ok(blocked.requiredRegressionCases.includes('SEND_EXISTS'),'do not erase historical regression coverage');
 assert.equal(blocked.autoActivateAllowed,false);
});
test('scope and validation ordering alone cannot create spurious impacts or bypass review for real changes',()=>{
 const oldRaw=valid();
 oldRaw.urlPatterns=['https://example.org/app/*','https://example.org/legacy/*'];
 oldRaw.validationCases=['APP_READY','SEND_EXISTS'];
 const previous=parseSiteAdapter(oldRaw);
 const reordered=valid();reordered.version='1.1.0';
 reordered.urlPatterns=['https://example.org/legacy/*','https://example.org/app/*'];
 reordered.validationCases=['SEND_EXISTS','APP_READY'];
 const deps=[{scriptId:'pinned',siteId:'example-app',pinnedVersion:'1.0.0',roles:['chat.sendButton'],regressionCases:['LOCAL']}];
 const report=assessSiteAdapterUpgrade({previous,next:parseSiteAdapter(reordered),dependencies:deps});
 assert.equal(report.status,'unchanged');
 assert.equal(report.changedScope,false);
 assert.equal(report.changedValidationCases,false);
 assert.deepEqual(report.affectedScriptIds,[]);
 assert.deepEqual(report.removedScopePatterns,[]);
 assert.deepEqual(report.removedValidationCases,[]);
});

test('single top-level open ShadowRoot roles resolve to explicit read-only shadow context',()=>{
 const raw=valid();
 raw.roles['chat.shadowButton']={
  contexts:[{stateId:'ready',frame:'top',shadow:'open'}],
  strategies:[{kind:'css',selector:'#shadow-send',weight:90}],
  cardinality:{min:1,max:1},assertions:['unique'],
 };
 const adapter=parseSiteAdapter(raw);
 const got=resolveSiteAdapterRole({adapter,pageUrl:'https://example.org/app/inbox',roleId:'chat.shadowButton',observedStateId:'ready'});
 assert.equal(got.status,'candidate-only');
 assert.equal(got.rootScope,'open-shadow');
 assert.deepEqual(got.selectors,['#shadow-send']);
});
test('mixed top-document and open-shadow contexts cannot be guessed into a single root',()=>{
 const raw=valid();
 raw.roles['chat.shadowButton']={
  contexts:[{stateId:'ready',frame:'top',shadow:'none'},{stateId:'ready',frame:'top',shadow:'open'}],
  strategies:[{kind:'css',selector:'#shadow-send',weight:90}],
  cardinality:{min:1,max:1},assertions:['unique'],
 };
 const got=resolveSiteAdapterRole({adapter:parseSiteAdapter(raw),pageUrl:'https://example.org/app/inbox',roleId:'chat.shadowButton',observedStateId:'ready'});
 assert.equal(got.status,'blocked-context');
 assert.equal(got.rootScope,null);
});

test('a declared iframe-only role resolves to explicit iframe-document, never the top document',()=>{
 const raw=valid();
 const adapter=parseSiteAdapter(raw);
 const role=resolveSiteAdapterRole({adapter,pageUrl:'https://example.org/app/inbox',
  roleId:'chat.frameButton',observedStateId:'ready'});
 assert.equal(role.status,'candidate-only');
 assert.equal(role.rootScope,'iframe-document');
 assert.deepEqual(role.selectors,['#send-inside-frame']);
});
test('mixed top-frame and iframe same-state contexts do not silently select one',()=>{
 const raw=valid();
 raw.roles['chat.frameButton'].contexts=[
  {stateId:'ready',frame:'top',shadow:'none'},{stateId:'ready',frame:'iframe',shadow:'none'},
 ];
 const role=resolveSiteAdapterRole({adapter:parseSiteAdapter(raw),
  pageUrl:'https://example.org/app/inbox',roleId:'chat.frameButton',observedStateId:'ready'});
 assert.equal(role.status,'blocked-context');
 assert.equal(role.rootScope,null);
});
