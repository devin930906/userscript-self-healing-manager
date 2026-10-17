import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifySyntheticExtensionProbe} from '../../scripts/synthetic-extension-probe-evidence.ts';

const url='http://127.0.0.1:4040/fixture';
const id='fixture-target';
const found=()=>({status:'found',matchCount:1});
const evidence=(checks: unknown[])=>({validationLevel:'dom-only',targetId:id,url,checks});

test('accepts only three exact observed synthetic extension markers',()=>{
 assert.equal(classifySyntheticExtensionProbe(evidence([found(),found(),found()]),id,url),'verified');
 assert.equal(classifySyntheticExtensionProbe(evidence([found(),found(),{status:'found',matchCount:2}]),id,url),'runtime-roundtrip-not-observed');
});

test('distinguishes missing content script from missing runtime API and roundtrip',()=>{
 assert.equal(classifySyntheticExtensionProbe(evidence([{status:'missing',matchCount:0},found(),found()]),id,url),'content-script-not-observed');
 assert.equal(classifySyntheticExtensionProbe(evidence([found(),{status:'missing',matchCount:0},found()]),id,url),'runtime-onmessage-not-observed');
 assert.equal(classifySyntheticExtensionProbe(evidence([found(),found(),{status:'missing',matchCount:0}]),id,url),'runtime-roundtrip-not-observed');
});

test('rejects stale, cross-page and malformed evidence before marker classification',()=>{
 const good=[found(),found(),found()];
 assert.equal(classifySyntheticExtensionProbe(evidence(good),'other-page',url),'untrusted-probe');
 assert.equal(classifySyntheticExtensionProbe(evidence(good),id,'http://127.0.0.1:4041/fixture'),'untrusted-probe');
 assert.equal(classifySyntheticExtensionProbe(evidence(good.slice(0,2)),id,url),'untrusted-probe');
 assert.equal(classifySyntheticExtensionProbe(null,id,url),'untrusted-probe');
 assert.equal(classifySyntheticExtensionProbe(evidence([null,found(),found()]),id,url),'untrusted-probe');
});
