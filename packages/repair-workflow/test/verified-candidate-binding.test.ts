import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareVerifiedRepairPreview} from '../src/verified-preview.ts';
import type {VerifiedCandidate} from '../../candidate-engine/src/workflow.ts';

const target={id:'approved-page',url:'https://example.org/editor'};
const identity={targetId:target.id,confirmedUrl:target.url,frameId:'frame-1',loaderId:'loader-1'};
const sha='a'.repeat(64);

test('preview refuses candidate CSS evidence that contradicts the proposed selector for any supported DOM API',async()=>{
 for(const [method,expression,cssSelector] of [
  ['querySelector','[data-testid="send-btn"]','#unrelated'],
  ['getElementById','send-btn','#unrelated'],
  ['getElementsByName','send-field','[name="unrelated"]'],
  ['getElementsByClassName','send-panel','.unrelated'],
 ]){
  let proposals=0;
  const candidate:VerifiedCandidate={
   expression,cssSelector,source:'DOMSnapshot',matchCount:1,confidenceScore:80,
   evidence:'fixture',validationLevel:'dom-candidate-verified',approved:false,
  };
  await assert.rejects(prepareVerifiedRepairPreview({
   approved:true,target,locator:{method,expression:'old-locator',runtimeRequired:false},
   source:{scriptId:'safe-script',sourcePath:'/trusted/source.user.js',expectedSha256:sha,
    selectorLocation:{method,line:1,column:1}},
   deps:{
    confirm:async()=>identity,discover:async()=>[candidate],verifySource:async()=>{},
    propose:async()=>{proposals++;throw Error('Mismatched evidence must not propose a patch');},
    revoke:()=>{},
   },
  }),/candidate|evidence|selector|mismatch|css/i);
  assert.equal(proposals,0,'mismatched candidate must not reach the patch preview: '+method);
 }
});
