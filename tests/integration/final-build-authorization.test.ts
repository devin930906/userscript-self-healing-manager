import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {assertFinalBuildAuthorization} from '../../scripts/final-build-authorization.mjs';

test('manual Windows final packaging authorizes only an exact stable version tag',()=>{
 assert.deepEqual(assertFinalBuildAuthorization({
  ref:'refs/tags/v1.0.0',eventName:'workflow_dispatch',packageVersion:'1.0.0',
 }),{version:'1.0.0',ref:'refs/tags/v1.0.0',finalTagOnly:true});
 assert.deepEqual(assertFinalBuildAuthorization({
  ref:'refs/tags/v2.12.4',eventName:'workflow_dispatch',packageVersion:'2.12.4',
 }),{version:'2.12.4',ref:'refs/tags/v2.12.4',finalTagOnly:true});
});

test('no Alpha, branch, PR or mismatched tag may reach Windows installers',()=>{
 for(const scenario of [
  {ref:'refs/heads/feat/v01-continuation',eventName:'workflow_dispatch',packageVersion:'0.1.0-alpha.5'},
  {ref:'refs/heads/main',eventName:'workflow_dispatch',packageVersion:'1.0.0'},
  {ref:'refs/tags/v0.1.0-alpha.5',eventName:'workflow_dispatch',packageVersion:'0.1.0-alpha.5'},
  {ref:'refs/tags/v1.0.0-rc.1',eventName:'workflow_dispatch',packageVersion:'1.0.0-rc.1'},
  {ref:'refs/tags/v1.0.0',eventName:'workflow_dispatch',packageVersion:'0.1.0-alpha.5'},
  {ref:'refs/tags/v1.0.0',eventName:'push',packageVersion:'1.0.0'},
  {ref:'refs/tags/v01.0.0',eventName:'workflow_dispatch',packageVersion:'01.0.0'},
  {ref:'refs/tags/v1.0.0/other',eventName:'workflow_dispatch',packageVersion:'1.0.0'},
  {ref:'refs/tags/v1.0.0',eventName:'workflow_dispatch',packageVersion:'1.0.1'},
 ]){
  assert.throws(()=>assertFinalBuildAuthorization(scenario),/final|tag|version|prerelease|ref|release/i,
   JSON.stringify(scenario));
 }
});

test('Windows packaging workflow enforces tag guard before npm ci, build and electron-builder',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const gate=workflow.indexOf('node scripts/final-build-authorization.mjs');
 const install=workflow.indexOf('run: npm ci');
 const packageStep=workflow.indexOf('run: npm run dist:win');
 assert.ok(gate>0 && gate<install && install<packageStep,
  'Fail closed before installing dependencies, building or uploading any edition');
 assert.match(workflow,/USSHM_BUILD_REF:\s*\$\{\{ github\.ref \}\}/);
 assert.match(workflow,/USSHM_BUILD_EVENT:\s*\$\{\{ github\.event_name \}\}/);
});
