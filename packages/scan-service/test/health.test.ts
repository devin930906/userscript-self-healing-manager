import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeLiveLocatorCheck} from '../src/health.ts';
test('live DOM evidence distinguishes missing selectors from full app functionality',()=>{
 const s=summarizeLiveLocatorCheck([
  {status:'found',matchCount:1},
  {status:'missing',matchCount:0},
  {status:'unverified',matchCount:null},
 ]);
 assert.deepEqual(s,{status:'locator-missing',total:3,found:1,missing:1,needsReview:1,validationLevel:'dom-only'});
});
test('only present document selectors means DOM present, never script verified',()=>{
 assert.equal(summarizeLiveLocatorCheck([{status:'found',matchCount:2}]).status,'dom-present');
 assert.equal(summarizeLiveLocatorCheck([]).status,'no-evidence');
 assert.equal(summarizeLiveLocatorCheck([{status:'blocked',matchCount:null}]).status,'needs-review');
});
