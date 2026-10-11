import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectVerificationLevels} from '../src/verification-levels.ts';

test('static AST parses may only attest V0; never V1-V4 or business success',()=>{
 const outcome=projectVerificationLevels({staticStatus:'parsed'});
 assert.equal(outcome.V0,'passed');
 assert.equal(outcome.V1,'blocked');
 assert.equal(outcome.V2,'blocked');
 assert.equal(outcome.V3,'not-configured');
 assert.equal(outcome.V4,'not-configured');
 assert.equal(outcome.highestVerified,'V0');
 assert.equal(outcome.functionalVerified,false);
 assert.equal(outcome.managerVerified,false);
});
test('real DOM evidence may pass V1 only after V0 and reliable document checks',()=>{
 const good=projectVerificationLevels({staticStatus:'parsed',dom:{status:'dom-present',checked:2,found:2,missing:0,needsReview:0}});
 assert.equal(good.V1,'passed');
 assert.equal(good.highestVerified,'V1');
 assert.equal(good.V2,'blocked');
 assert.equal(good.functionalVerified,false);
 for(const bad of [
  {status:'dom-present',checked:0,found:0,missing:0,needsReview:0},
  {status:'dom-present',checked:2,found:1,missing:0,needsReview:0},
  {status:'needs-review',checked:2,found:1,missing:0,needsReview:1},
 ]){
  const evidence=projectVerificationLevels({staticStatus:'parsed',dom:bad});
  assert.notEqual(evidence.V1,'passed');
 }
});
test('missing locator is a V1 failure but is never a V3 functional-failure claim',()=>{
 const result=projectVerificationLevels({staticStatus:'parsed',dom:{status:'locator-missing',checked:2,found:1,missing:1,needsReview:0}});
 assert.equal(result.V1,'failed');
 assert.equal(result.V2,'blocked');
 assert.equal(result.V3,'not-configured');
 assert.equal(result.functionalVerified,false);
});
test('parse errors and untrusted scope block all higher evidence levels',()=>{
 for(const status of ['parse-error','unreadable','skipped'] as const){
  const result=projectVerificationLevels({staticStatus:status,dom:{status:'dom-present',checked:1,found:1,missing:0,needsReview:0}});
  assert.notEqual(result.V0,'passed');
  assert.notEqual(result.V1,'passed');
  assert.equal(result.highestVerified,null);
 }
});
test('out-of-scope, unknown shadow or iframe, error and no evidence cannot claim V1',()=>{
 for(const status of ['needs-review','out-of-scope','error','no-evidence','skipped'] as const){
  const result=projectVerificationLevels({staticStatus:'parsed',dom:{status,checked:0,found:0,missing:0,needsReview:0}});
  assert.notEqual(result.V1,'passed');
 }
});
