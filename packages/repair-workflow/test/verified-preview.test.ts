import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareVerifiedRepairPreview} from '../src/verified-preview.ts';
import type {VerifiedCandidate} from '../../candidate-engine/src/workflow.ts';

const target={id:'trusted-page',url:'https://example.org/editor'};
const identity={targetId:target.id,confirmedUrl:target.url,frameId:'main',loaderId:'document-1'};
const candidate:VerifiedCandidate={
 expression:'[data-testid="submitAction"]',cssSelector:'[data-testid="submitAction"]',
 source:'DOMSnapshot',matchCount:1,confidenceScore:86,evidence:'fixture-only',
 validationLevel:'dom-candidate-verified',approved:false,
};
const original='c'.repeat(64);
function fixture(opts:{candidates?:VerifiedCandidate[];beforePropose?:()=>void;afterPropose?:()=>void;badSource?:boolean}={}){
 let confirms=0,proposals=0,revokes=0,checks=0;
 const d={
  confirm:async()=>{confirms++;return identity;},
  discover:async()=>opts.candidates??[candidate],
  verifySource:async()=>{checks++;if(opts.badSource)throw new Error('Source script hash changed');},
  propose:async(selector:string)=>{
   proposals++;opts.beforePropose?.();
   const r={proposalId:'proposal-1',scriptId:'script-1',oldSelector:'#broken',
    newSelector:selector,originalHash:original,baseHash:original,
    proposedHash:'d'.repeat(64),preview:'document.querySelector('+JSON.stringify(selector)+')'};
   opts.afterPropose?.();return r;
  },
  revoke:()=>{revokes++;},
 };
 const input={approved:true,target,locator:{method:'querySelector',expression:'#broken',runtimeRequired:false},
  source:{scriptId:'script-1',sourcePath:'/trusted/script.user.js',expectedSha256:original,
   selectorLocation:{method:'querySelector',line:1,column:1}},
  deps:d,
 };
 return {input,stats:()=>({confirms,proposals,revokes,checks})};
}
test('one confirmed replacement prepares a managed preview but never applies or promotes to V2-V4',async()=>{
 const f=fixture();
 const r=await prepareVerifiedRepairPreview(f.input);
 assert.equal(r.status,'prepared');
 assert.equal(r.proposal?.newSelector,candidate.expression);
 assert.equal(r.candidate?.expression,candidate.expression);
 assert.equal(r.productionVerified,false);
 assert.equal(r.verificationLevel,'dom-only');
 assert.equal(r.V2,'blocked');assert.equal(r.V3,'not-configured');assert.equal(r.V4,'not-configured');
 assert.deepEqual(f.stats(),{confirms:3,proposals:1,revokes:0,checks:2});
});
test('zero or competing verified candidates fail closed without writing a proposal',async()=>{
 for(const suggestions of [[],[candidate,{...candidate,expression:'#second',cssSelector:'#second'}]]){
  const f=fixture({candidates:suggestions});
  const result=await prepareVerifiedRepairPreview(f.input);
  assert.equal(result.status,'needs-review');
  assert.equal(result.proposal,null);
  assert.equal(f.stats().proposals,0);
 }
});
test('page same-URL reload before source check or after proposal discards unsafe preview',async()=>{
 for(const changeAfter of [2,3]){
  const f=fixture();
  let calls=0;
  f.input.deps.confirm=async()=>({...identity,loaderId:++calls>=changeAfter?'reloaded':'document-1'});
  await assert.rejects(prepareVerifiedRepairPreview(f.input),/identity|document|loader|reload/i);
  assert.equal(f.stats().revokes,changeAfter===3?1:0);
 }
});
test('source scan mismatch and untrusted candidate cannot proceed to a patch',async()=>{
 const changed=fixture({badSource:true});
 await assert.rejects(prepareVerifiedRepairPreview(changed.input),/hash|changed/i);
 assert.equal(changed.stats().proposals,0);
 const spoofed=fixture({candidates:[{...candidate,approved:true} as VerifiedCandidate]});
 await assert.rejects(prepareVerifiedRepairPreview(spoofed.input),/candidate|approval|evidence|verified/i);
 assert.equal(spoofed.stats().proposals,0);
});
test('rejects missing consent, runtime selector, invalid source hash and stale returned proposal before publishing',async()=>{
 for(const mutation of [
  (x:any)=>{x.approved=false;},
  (x:any)=>{x.locator.runtimeRequired=true;},
  (x:any)=>{x.locator.method='closest';},
  (x:any)=>{x.source.expectedSha256='no-hash';},
 ]){
  const f=fixture();mutation(f.input);
  await assert.rejects(prepareVerifiedRepairPreview(f.input),/consent|selector|hash|literal|invalid|supported/i);
  assert.equal(f.stats().proposals,0);
 }
 const forged=fixture();
 forged.input.deps.propose=async()=>({
  proposalId:'fake',scriptId:'different',oldSelector:'#broken',newSelector:candidate.expression,
  originalHash:original,baseHash:original,proposedHash:'f'.repeat(64),preview:'injected',
 });
 await assert.rejects(prepareVerifiedRepairPreview(forged.input),/proposal|identity|source|mismatch/i);
 assert.equal(forged.stats().revokes,1);
});
