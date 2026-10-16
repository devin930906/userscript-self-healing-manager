import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkUserscriptPageScope} from '../src/page-scope.ts';
const meta=(match:string[],include:string[]=[],raw:Record<string,string[]>={})=>({match,include,raw});
test('match globs honor scheme, apex and subdomains but reject other domains',()=>{
 const m=meta(['*://*.example.com/app/*']);
 assert.equal(checkUserscriptPageScope(m,'https://example.com/app/abc').status,'allowed');
 assert.equal(checkUserscriptPageScope(m,'http://sub.example.com/app/abc').status,'allowed');
 assert.equal(checkUserscriptPageScope(m,'https://evil-example.com/app/abc').status,'blocked');
 assert.equal(checkUserscriptPageScope(m,'https://example.com/other').status,'blocked');
});
test('deny rules override matching allow rules',()=>{
 const m=meta(['*://*.example.com/*'],[],{'exclude-match':['*://admin.example.com/*']});
 assert.equal(checkUserscriptPageScope(m,'https://admin.example.com/users').status,'blocked');
 assert.equal(checkUserscriptPageScope(m,'https://www.example.com/page').status,'allowed');
});
test('no metadata, unsupported regex and non-web URL fail closed',()=>{
 assert.equal(checkUserscriptPageScope(meta([]),'https://example.com').status,'unknown');
 assert.equal(checkUserscriptPageScope(meta([],['/^https/']),'https://example.com').status,'unknown');
 assert.equal(checkUserscriptPageScope(meta(['*://*/*']),'file:///C:/temp').status,'blocked');
 assert.equal(checkUserscriptPageScope(meta(['*://*/*']),'javascript:alert(1)').status,'blocked');
});
test('include globs accept exact host and path without matching lookalikes',()=>{
 const m=meta([],['https://example.com/products/*']);
 assert.equal(checkUserscriptPageScope(m,'https://example.com/products/one').status,'allowed');
 assert.equal(checkUserscriptPageScope(m,'https://sub.example.com/products/one').status,'blocked');
});

test('unsupported @exclude rules fail closed even when @match allows the page',()=>{
 const m=meta(['*://example.com/*'],[],{'exclude':['/^https:\\\/\\\/example\\.com/']});
 assert.equal(checkUserscriptPageScope(m,'https://example.com/profile').status,'unknown');
});
test('unsupported @exclude-match syntax cannot silently disable protection',()=>{
 const m=meta(['*://example.com/*'],[],{'exclude-match':['not-a-match-pattern']});
 assert.equal(checkUserscriptPageScope(m,'https://example.com/profile').status,'unknown');
});

test('oversized userscript match patterns are unknown rather than compiled as unbounded regular expressions',()=>{
 const huge='https://example.com/'+('a'.repeat(2100));
 assert.equal(checkUserscriptPageScope(meta([huge]),'https://example.com/a').status,'unknown');
 assert.equal(checkUserscriptPageScope(meta(['https://example.com/*'],[],{'exclude-match':[huge]}),'https://example.com/a').status,'unknown');
});
test('many wildcard pieces match deterministically without regular expressions',()=>{
 const many='https://example.com/'+'*'.repeat(350)+'target';
 assert.equal(checkUserscriptPageScope(meta([many]),'https://example.com/target').status,'allowed');
 assert.equal(checkUserscriptPageScope(meta([many]),'https://example.com/miss').status,'blocked');
});

test('unsupported host syntax in exclusion rules cannot silently authorize the page',()=>{
 const invalid=['*://foo*bar.example.org/*','https://example.org:443/*','https://**.example.org/*'];
 for(const deny of invalid){
  const m=meta(['https://example.org/*'],[],{'exclude-match':[deny]});
  assert.equal(checkUserscriptPageScope(m,'https://example.org/page').status,'unknown',deny);
 }
});

test('include path is case sensitive while URL scheme and host are case insensitive',()=>{
 const m=meta([],['https://example.com/Admin/*']);
 assert.equal(checkUserscriptPageScope(m,'https://EXAMPLE.COM/Admin/settings').status,'allowed');
 assert.equal(checkUserscriptPageScope(m,'https://example.com/admin/settings').status,'blocked');
});
test('case-sensitive @exclude does not block a distinct lower-case path',()=>{
 const m=meta(['https://example.com/*'],[],{exclude:['https://example.com/Admin/*']});
 assert.equal(checkUserscriptPageScope(m,'https://example.com/Admin/settings').status,'blocked');
 assert.equal(checkUserscriptPageScope(m,'https://example.com/admin/settings').status,'allowed');
});
test('unsupported regular-expression URL include remains unknown, not a match',()=>{
 assert.equal(checkUserscriptPageScope(meta([],['/example\\.com\/admin/']),'https://example.com/admin').status,'unknown');
});

test('oversized userscript activation-rule lists fail closed before any allow result',()=>{
 const allowed='https://example.org/*';
 const many=Array.from({length:257},()=>allowed);
 assert.equal(checkUserscriptPageScope(meta(many),'https://example.org/page').status,'unknown');
 assert.equal(checkUserscriptPageScope(meta([allowed],many),'https://example.org/page').status,'unknown');
 assert.equal(checkUserscriptPageScope(meta([allowed],[],{exclude:many}),'https://example.org/page').status,'unknown');
 assert.equal(checkUserscriptPageScope(meta([allowed],[],{'exclude-match':many}),'https://example.org/page').status,'unknown');
 const withinBudget=Array.from({length:256},()=>allowed);
 assert.equal(checkUserscriptPageScope(meta(withinBudget),'https://example.org/page').status,'allowed');
});

test('aggregate hostile metadata pattern size cannot bypass a scope budget via many sub-limit rules',()=>{
 const allowed='https://example.org/*';
 const longRule='https://example.org/'+'x'.repeat(1940);
 const matches=[allowed,...Array.from({length:40},()=>longRule)];
 assert.equal(checkUserscriptPageScope(meta(matches),'https://example.org/page').status,'unknown');
 assert.equal(checkUserscriptPageScope(meta([allowed],[],{exclude:Array.from({length:40},()=>longRule)}),'https://example.org/page').status,'unknown');
});

test('RG-04 credentialed CDP target URLs cannot inherit an authorized userscript page scope',()=>{
 const m=meta(['https://example.org/*']);
 for(const page of [
  'https://synthetic-user:synthetic-secret@example.org/settings',
  'https://synthetic-user@example.org/settings',
  'https://%73ynthetic-user:%73ynthetic-secret@example.org/settings',
 ]){
  const verdict=checkUserscriptPageScope(m,page);
  assert.equal(verdict.status,'blocked','credentialed page authority must not be treated as an ordinary site target');
 }
 assert.equal(checkUserscriptPageScope(m,'https://example.org/settings').status,'allowed');
});

test('RG-01 accessor-backed deny rules fail closed without running untrusted getters',()=>{
 let invoked=0;
 const raw:Record<string,string[]>={};
 Object.defineProperty(raw,'exclude',{
  enumerable:true,
  get(){invoked++;throw new Error('PRIVATE-METADATA-GETTER');},
 });
 const verdict=checkUserscriptPageScope(
  meta(['https://example.org/*'],[],raw),
  'https://example.org/private',
 );
 assert.equal(verdict.status,'unknown');
 assert.equal(invoked,0,'the policy decision must inspect only metadata data properties');
 assert.doesNotMatch(JSON.stringify(verdict),/PRIVATE-METADATA/);
});

test('RG-01 getter-backed rule-array elements cannot grant page authorization',()=>{
 let invoked=0;
 const allow=['https://example.org/*'];
 Object.defineProperty(allow,'0',{
  configurable:true,enumerable:true,
  get(){invoked++;throw new Error('PRIVATE-PATTERN-GETTER');},
 });
 const verdict=checkUserscriptPageScope(meta(allow),'https://example.org/private');
 assert.equal(verdict.status,'unknown');
 assert.equal(invoked,0,'a hostile array element getter must never be evaluated');
 assert.doesNotMatch(JSON.stringify(verdict),/PRIVATE-PATTERN/);
});

test('RG-01 cannot ignore exclusion rules when a Proxy spoofs array length',()=>{
 for(const key of ['exclude','exclude-match'] as const){
  let reads=0;
  const rules=new Proxy(['https://example.org/private/*'],{
   get(target,property,receiver){
    if(property==='length'){reads++;return 0;}
    return Reflect.get(target,property,receiver);
   },
  });
  const scope=meta(['https://example.org/*'],[],{[key]:rules});
  const verdict=checkUserscriptPageScope(scope,'https://example.org/private/account');
  assert.notEqual(verdict.status,'allowed',
   'a hidden '+key+' must not authorize an excluded document');
  assert.equal(reads,0,'hostile array length getter must not determine exclusion rules');
 }
});

test('RG-01 exclusion rule budget cannot be truncated by spoofing array length',()=>{
 const oversized=Array.from({length:257},()=> 'https://example.org/*');
 const rules=new Proxy(oversized,{
  get(target,property,receiver){
   if(property==='length')return 1;
   return Reflect.get(target,property,receiver);
  },
 });
 const scope=meta(['https://example.org/*'],[],{exclude:rules});
 assert.equal(checkUserscriptPageScope(scope,'https://example.org/home').status,'unknown');
});

test('RG-01 rejects forged own-length descriptors that omit a real exclusion',()=>{
 for(const key of ['exclude','exclude-match'] as const){
  const rule='https://example.org/private/*';
  const rules=new Proxy([rule],{
   getOwnPropertyDescriptor(target,property){
    const descriptor=Reflect.getOwnPropertyDescriptor(target,property);
    return property==='length'&&descriptor?{...descriptor,value:0}:descriptor;
   },
  });
  const verdict=checkUserscriptPageScope(
   meta(['https://example.org/*'],[],{[key]:rules}),
   'https://example.org/private/account',
  );
  assert.equal(verdict.status,'unknown',
   'a forged length descriptor cannot erase a real '+key+' rule');
 }
});

test('RG-01 never grants a page on coherently forged Proxy length and ownKeys',()=>{
 let indexGetterCalls=0;
 const rules=new Proxy(['https://example.org/private/*'],{
  getOwnPropertyDescriptor(target,key){
   const own=Reflect.getOwnPropertyDescriptor(target,key);
   if(key==='length'&&own)return {...own,value:0};
   return own;
  },
  ownKeys(){return ['length'];},
  get(target,key,receiver){
   if(key==='0')indexGetterCalls++;
   return Reflect.get(target,key,receiver);
  },
 });
 const verdict=checkUserscriptPageScope(
  meta(['https://example.org/*'],[],{exclude:rules}),
  'https://example.org/private/account',
 );
 assert.equal(verdict.status,'unknown',
  'a forged descriptor and hidden configurable indices must fail closed');
 assert.equal(indexGetterCalls,0,'private rule values must not be read through Proxy get traps');
});

test('RG-01 refuses extra accessor keys before deep-cloning exclusion arrays',()=>{
 let secretReads=0;
 const rules=['https://example.org/private/*'];
 Object.defineProperty(rules,'privateMarker',{enumerable:true,get(){
  secretReads++;throw new Error('PRIVATE_SCOPE_EXTRA_GETTER');
 }});
 const verdict=checkUserscriptPageScope(
  meta(['https://example.org/*'],[],{exclude:rules}),
  'https://example.org/private/account',
 );
 assert.equal(verdict.status,'unknown');
 assert.equal(secretReads,0,'no unexpected metadata getter may run in safety validation');
 assert.doesNotMatch(JSON.stringify(verdict),/PRIVATE_SCOPE_EXTRA_GETTER/);
});


test('RG-01 rejects object-backed URL coercion without invoking untrusted code',()=>{
 let evaluations=0;
 const hostileUrl={
  toString(){evaluations++;return 'https://example.org/private';},
  [Symbol.toPrimitive](){evaluations++;return 'https://example.org/private';},
 };
 const scope=meta(['https://example.org/*']);
 const verdict=checkUserscriptPageScope(scope,hostileUrl as unknown as string);
 assert.equal(verdict.status,'blocked','an object must never grant a userscript page scope');
 assert.equal(verdict.reason,'Invalid page URL');
 assert.equal(evaluations,0,'hostile URL coercion must not be evaluated');
});

test('RG-01 bounds untrusted page URLs before parsing or matching activation rules',()=>{
 const scope=meta(['https://example.org/*']);
 const oversized='https://example.org/?'+('x'.repeat(100_000));
 const verdict=checkUserscriptPageScope(scope,oversized);
 assert.equal(verdict.status,'blocked');
 assert.equal(verdict.reason,'Invalid page URL');
 assert.equal(checkUserscriptPageScope(scope,'https://example.org/valid').status,'allowed');
});
