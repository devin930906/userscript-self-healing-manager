import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('Development CI keeps mandatory build, Electron and Chrome checks while separating official manager acceptance',async()=>{
 const workflow=await readFile('.github/workflows/dev-ci.yml','utf8');
 for(const token of [
  'Audit locked dependency advisories',
  'Generate and validate CycloneDX dependency SBOM',
  'Run all tests',
  'Strict TypeScript checks',
  'Build renderer and Electron entrypoint',
  'Real Electron 44 security integration',
  'Real built Electron GUI launch',
  'Real Chrome 155 loopback CDP',
  'Real Chrome for Testing 155 isolated MV3 extension load',
 ]){
  assert.ok(workflow.includes(token),'Development CI must retain '+token);
 }
 assert.match(workflow,/run: node --experimental-strip-types scripts\/smoke-extension-cft\.mjs/);
 assert.doesNotMatch(workflow,/continue-on-error/,'Synthetic MV3 must fail the integration check if broken');
 assert.doesNotMatch(workflow,/smoke-violentmonkey-cft\.mjs/,'Official GM must not make independently verified development work appear broken');
});

test('Dedicated Stable RG-05 workflow runs on integration pushes and fails closed on real official GM cold restart',async()=>{
 const workflow=await readFile('.github/workflows/stable-rg05-gate.yml','utf8');
 assert.match(workflow,/push:\s*\n\s*branches:\s*\[feat\/v01-continuation\]/);
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/runs-on:\s*windows-latest/);
 assert.match(workflow,/node-version:\s*'24'/);
 assert.match(workflow,/155\.0\.8059\.39/);
 assert.match(workflow,/scripts\/smoke-extension-cft\.mjs/);
 assert.match(workflow,/scripts\/download-violentmonkey-release\.mjs/);
 assert.match(workflow,/3fa676c803a9698453ed23dfe496d4bc29a4bec52f6a95e55c43c2955921f8ee/);
 assert.match(workflow,/scripts\/smoke-violentmonkey-cft\.mjs/);
 assert.doesNotMatch(workflow,/continue-on-error|\|\|\s*true|fail-fast:\s*false/i);
 assert.ok(workflow.indexOf('smoke-extension-cft.mjs')<workflow.indexOf('smoke-violentmonkey-cft.mjs'));
 assert.doesNotMatch(workflow,/electron-builder|dist:win|upload-artifact/,'An unresolved gate cannot publish installers');
});

test('Final three-edition tag build still requires real official manager acceptance before packaging',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const preflight=workflow.indexOf('node scripts/final-build-authorization.mjs');
 const manager=workflow.indexOf('node --experimental-strip-types scripts/smoke-violentmonkey-cft.mjs');
 const pack=workflow.indexOf('run: npm run dist:win');
 assert.ok(preflight>=0&&manager>preflight&&pack>manager,
  'Final-tag packaging must retain required real GM gate before the first installer build');
 const activeGate=workflow.slice(manager,pack);
 assert.doesNotMatch(activeGate,/continue-on-error/i);
});
