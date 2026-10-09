import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeDomBatchReport} from '../src/dom-report.ts';
import type {BatchDomResult} from '../../scan-service/src/batch-dom.ts';

const sample:BatchDomResult={
 validationLevel:'dom-only',
 pageTargetId:'frame-synthetic',pageUrl:'https://example.org/private/page?apiKey=secret-access#token-123',
 pageDocumentToken:'a'.repeat(64),
 totalItems:1,items:[{
  index:0,scriptId:'synthetic-1',path:'C:\\Users\\Private\\Scripts\\example.user.js',
  status:'dom-present',checked:1,found:1,missing:0,needsReview:0,
  reason:'Private DOM text do-not-export',
  verification:{V0:'passed',V1:'passed',V2:'blocked',V3:'not-configured',V4:'not-configured',
    highestVerified:'V1',functionalVerified:false,managerVerified:false},
 }],
};
test('DOM report JSON preserves statuses but redacts URLs, internal tokens, private paths and raw DOM reasons',()=>{
 const json=serializeDomBatchReport(sample,'json','2026-10-09T06:30:00.000Z');
 const dto=JSON.parse(json);
 assert.equal(dto.schemaVersion,1);
 assert.equal(dto.scanMode,'dom-only');
 assert.equal(dto.pageOrigin,'https://example.org');
 assert.equal(dto.items[0].name,'example.user.js');
 assert.equal(dto.items[0].verification.V1,'passed');
 assert.equal(dto.items[0].verification.V3,'not-configured');
 assert.equal(dto.items[0].verification.V4,'not-configured');
 for(const forbidden of ['secret-access','token-123','Private','do-not-export','frame-synthetic','a'.repeat(64),'pageDocumentToken']){
  assert.equal(json.includes(forbidden),false,forbidden);
 }
});
test('DOM report Markdown escapes filenames and never claims Tampermonkey function validation',()=>{
 const data:{[key:string]:any}={...sample,items:[{...sample.items[0],path:'C:\\scripts\\<img|onerror>.user.js'}]};
 const out=serializeDomBatchReport(data as BatchDomResult,'markdown','2026-10-09T06:30:00.000Z');
 assert.match(out,/V0.*V1.*V2.*V3.*V4/);
 assert.match(out,/未运行.*Tampermonkey|不代表.*功能/);
 assert.doesNotMatch(out,/<img|apiKey|frame-synthetic/);
 assert.match(out,/\\\|/);
});
test('DOM report rejects malformed or injected result fields before serialization',()=>{
 for(const bad of [
  {...sample,validationLevel:'manager-observed'},
  {...sample,totalItems:999},
  {...sample,items:[{...sample.items[0],checked:-1}]},
  {...sample,items:[{...sample.items[0],index:3}]},
  {...sample,items:[{...sample.items[0],status:'verified-functional'}]},
  {...sample,pageUrl:'file:///secrets'},
  {...sample,items:[{...sample.items[0],verification:{...sample.items[0].verification,V3:'passed'}}]},
 ]){
  assert.throws(()=>serializeDomBatchReport(bad as BatchDomResult,'json','2026-10-09T06:30:00.000Z'));
 }
});
