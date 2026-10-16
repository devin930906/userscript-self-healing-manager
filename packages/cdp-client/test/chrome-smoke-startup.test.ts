import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyChromeSmokeStartupFailure} from '../src/chrome-smoke-startup.ts';

const state={
 launchFailed:false,processExited:false,cdpResponded:false,fixtureTargetSeen:false,
};

test('QA-004 classifies real Chrome startup stages without treating transport failure as frame failure',()=>{
 assert.equal(classifyChromeSmokeStartupFailure(state),'cdp-no-valid-response');
 assert.equal(classifyChromeSmokeStartupFailure({...state,cdpResponded:true}),
  'fixture-target-not-observed');
 assert.equal(classifyChromeSmokeStartupFailure({...state,cdpResponded:true,fixtureTargetSeen:true}),
  'fixture-frame-unconfirmed');
});

test('QA-004 process spawn and exit outrank misleading earlier CDP observations',()=>{
 assert.equal(classifyChromeSmokeStartupFailure({...state,launchFailed:true}),
  'chrome-spawn-failed');
 assert.equal(classifyChromeSmokeStartupFailure({...state,processExited:true,cdpResponded:true,fixtureTargetSeen:true}),
  'chrome-exited');
});

test('QA-004 rejects impossible observation combinations instead of inventing a failure stage',()=>{
 assert.throws(()=>classifyChromeSmokeStartupFailure({...state,fixtureTargetSeen:true}),
  /invalid|inconsistent|observation/i);
});

test('QA-004 diagnostic labels are fixed, non-sensitive strings',()=>{
 const labels=[
  classifyChromeSmokeStartupFailure(state),
  classifyChromeSmokeStartupFailure({...state,cdpResponded:true}),
  classifyChromeSmokeStartupFailure({...state,cdpResponded:true,fixtureTargetSeen:true}),
  classifyChromeSmokeStartupFailure({...state,launchFailed:true}),
  classifyChromeSmokeStartupFailure({...state,processExited:true}),
 ];
 assert.equal(new Set(labels).size,5);
 for(const label of labels)assert.match(label,/^[a-z-]+$/);
});
