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
