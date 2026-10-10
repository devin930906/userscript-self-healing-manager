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
